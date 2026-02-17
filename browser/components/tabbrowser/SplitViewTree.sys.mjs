/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

class SplitNode {
  parent = null;
}

/**
 * A leaf node representing a single tab in the split.
 */
class LeafNode extends SplitNode {
  tab = null;
  tabCycleIndex = 0;

  constructor(tab) {
    super();
    this.tab = tab;
  }

  get panelId() {
    return this.tab.linkedPanel;
  }
}

/**
 * A branch node representing a split with two children.
 */
class BranchNode extends SplitNode {
  /** @type {"horizontal"|"vertical"} */
  orientation = "vertical";
  first = null;
  second = null;
  ratio = 0.5;

  /**
   * @param {SplitNode} first
   * @param {SplitNode} second
   * @param {"horizontal"|"vertical"} orientation
   */
  constructor(first, second, orientation) {
    super();
    this.orientation = orientation;
    this.first = first;
    this.second = second;
    first.parent = this;
    second.parent = this;
  }
}

const SPLITTER_SIZE_PX = 4;
const PANE_MARGIN_PX = 2;

/**
 * Manages the split view tree lifecycle. Panels stay as direct children of
 * tabpanels (browser elements cannot be reparented without losing content).
 * Layout uses absolute positioning computed from the tree topology so that
 * each split is fully independent.
 */
export class SplitViewTree {
  root = null;
  _document = null;
  _tabpanels = null;
  _window = null;
  _splitters = [];
  _boundOnTabSelect = null;
  _resizeObserver = null;

  /**
   * @param {Document} document
   * @param {Element} tabpanels
   * @param {Window} window
   */
  constructor(document, tabpanels, window) {
    this._document = document;
    this._tabpanels = tabpanels;
    this._window = window;

    this._boundOnTabSelect = this._onTabSelect.bind(this);
    this._window.addEventListener("TabSelect", this._boundOnTabSelect);

    this._resizeObserver = new window.ResizeObserver(() => {
      if (this.root) {
        this._computeLayout();
      }
    });
    this._resizeObserver.observe(this._tabpanels);
  }

  /**
   * Create a root split from two tabs.
   *
   * @param {MozTabbrowserTab} tab1
   * @param {MozTabbrowserTab} tab2
   * @param {"horizontal"|"vertical"} orientation
   * @returns {LeafNode[]}
   */
  split(tab1, tab2, orientation) {
    let leaf1 = new LeafNode(tab1);
    let leaf2 = new LeafNode(tab2);
    this.root = new BranchNode(leaf1, leaf2, orientation);
    this._tabpanels.setAttribute("splitview-tree", "true");
    this._applyLayout();
    return [leaf1, leaf2];
  }

  /**
   * Split an existing leaf into two panes.
   *
   * @param {LeafNode} leafNode
   * @param {"horizontal"|"vertical"} orientation
   * @param {MozTabbrowserTab} newTab
   * @returns {LeafNode}
   */
  splitLeaf(leafNode, orientation, newTab) {
    let oldParent = leafNode.parent;
    let newLeaf = new LeafNode(newTab);
    let branch = new BranchNode(leafNode, newLeaf, orientation);

    if (oldParent) {
      if (oldParent.first === leafNode) {
        oldParent.first = branch;
      } else {
        oldParent.second = branch;
      }
      branch.parent = oldParent;
    } else {
      this.root = branch;
    }

    this._applyLayout();
    return newLeaf;
  }

  /**
   * Close a leaf pane. Returns the surviving leaf to focus,
   * or null if the tree was fully closed.
   *
   * @param {LeafNode} leafNode
   * @returns {LeafNode|null}
   */
  closeLeaf(leafNode) {
    let parent = leafNode.parent;
    if (!parent) {
      this.destroy();
      return null;
    }

    this._clearPanelStyles(leafNode);

    let sibling = parent.first === leafNode ? parent.second : parent.first;

    if (parent.parent) {
      if (parent.parent.first === parent) {
        parent.parent.first = sibling;
      } else {
        parent.parent.second = sibling;
      }
      sibling.parent = parent.parent;
    } else {
      this.root = sibling;
      sibling.parent = null;
    }

    if (this.root instanceof LeafNode) {
      this._clearPanelStyles(this.root);
      this._removeSplitters();
      this._tabpanels.removeAttribute("splitview-tree");
      if (this._boundOnTabSelect) {
        this._window.removeEventListener("TabSelect", this._boundOnTabSelect);
        this._boundOnTabSelect = null;
      }
      this.root = null;
      return null;
    }

    this._applyLayout();
    let leaves = [];
    this._collectLeaves(sibling, leaves);
    return leaves[0] || null;
  }

  /**
   * Swap the tabs displayed in two leaf panes.
   *
   * @param {LeafNode} leaf1
   * @param {LeafNode} leaf2
   */
  replaceLeafTab(leaf, newTab) {
    let oldTab = leaf.tab;
    if (oldTab) {
      this._clearPanelStyles(leaf);
    }
    leaf.tab = newTab;
    leaf.tabCycleIndex = 0;
    this._applyLayout();
  }

  swapTabs(leaf1, leaf2) {
    let tempTab = leaf1.tab;
    leaf1.tab = leaf2.tab;
    leaf2.tab = tempTab;
    let tempIdx = leaf1.tabCycleIndex;
    leaf1.tabCycleIndex = leaf2.tabCycleIndex;
    leaf2.tabCycleIndex = tempIdx;
    this._applyLayout();
  }

  destroy() {
    if (this._boundOnTabSelect) {
      this._window.removeEventListener("TabSelect", this._boundOnTabSelect);
      this._boundOnTabSelect = null;
    }
    if (this._resizeObserver) {
      this._resizeObserver.disconnect();
      this._resizeObserver = null;
    }

    if (!this.root) {
      return;
    }

    this._deactivateAllPanels();
    this._removeSplitters();
    this._tabpanels.removeAttribute("splitview-tree");
    this.root = null;
  }

  _applyLayout() {
    for (let leaf of this.allLeaves()) {
      let panel = this._document.getElementById(leaf.panelId);
      if (panel) {
        panel.classList.add("split-view-panel-active", "split-tree-panel");
      }
    }
    this._computeLayout();
  }

  _showPanels() {
    for (let leaf of this.allLeaves()) {
      let panel = this._document.getElementById(leaf.panelId);
      if (panel) {
        panel.classList.add("split-view-panel-active");
      }
    }
    for (let s of this._splitters) {
      s.hidden = false;
    }
  }

  _hidePanels() {
    for (let leaf of this.allLeaves()) {
      let panel = this._document.getElementById(leaf.panelId);
      if (panel) {
        panel.classList.remove("split-view-panel-active");
      }
    }
    for (let s of this._splitters) {
      s.hidden = true;
    }
  }

  _clearPanelStyles(leafOrNode) {
    let leaves =
      leafOrNode instanceof LeafNode ? [leafOrNode] : this.allLeaves();
    for (let leaf of leaves) {
      let panel = this._document.getElementById(leaf.panelId);
      if (panel) {
        panel.classList.remove("split-view-panel-active", "split-tree-panel");
        panel.style.removeProperty("position");
        panel.style.removeProperty("left");
        panel.style.removeProperty("top");
        panel.style.removeProperty("width");
        panel.style.removeProperty("height");
      }
    }
  }

  _deactivateAllPanels() {
    for (let leaf of this.allLeaves()) {
      let panel = this._document.getElementById(leaf.panelId);
      if (panel) {
        panel.classList.remove("split-view-panel-active", "split-tree-panel");
        panel.style.removeProperty("position");
        panel.style.removeProperty("left");
        panel.style.removeProperty("top");
        panel.style.removeProperty("width");
        panel.style.removeProperty("height");
        panel.removeAttribute("column");
        panel.removeAttribute("width");
      }
    }
  }

  _removeSplitters() {
    for (let s of this._splitters) {
      s.remove();
    }
    this._splitters = [];
  }

  /**
   * Compute absolute positions for all panels and splitters from the tree.
   *
   * Each BranchNode divides its region into two halves (based on ratio)
   * separated by a splitter. Each split is independent — a horizontal
   * split in the left column does not affect the right column.
   */
  _computeLayout() {
    if (!this.root) {
      return;
    }

    let rect = this._tabpanels.getBoundingClientRect();
    let totalW = rect.width;
    let totalH = rect.height;
    if (totalW <= 0 || totalH <= 0) {
      return;
    }

    let leafPositions = [];
    let splitterPositions = [];
    this._layoutNode(
      this.root,
      0,
      0,
      totalW,
      totalH,
      leafPositions,
      splitterPositions
    );

    for (let { leaf, x, y, w, h } of leafPositions) {
      let panel = this._document.getElementById(leaf.panelId);
      if (!panel) {
        continue;
      }
      panel.style.position = "absolute";
      panel.style.left = `${x + PANE_MARGIN_PX}px`;
      panel.style.top = `${y + PANE_MARGIN_PX}px`;
      panel.style.width = `${w - 2 * PANE_MARGIN_PX}px`;
      panel.style.height = `${h - 2 * PANE_MARGIN_PX}px`;
    }

    this._updateSplitters(splitterPositions);
  }

  _layoutNode(node, x, y, w, h, leafPositions, splitterPositions) {
    if (node instanceof LeafNode) {
      leafPositions.push({ leaf: node, x, y, w, h });
      return;
    }

    let gap = SPLITTER_SIZE_PX;
    if (node.orientation === "vertical") {
      let firstW = (w - gap) * node.ratio;
      let secondW = w - gap - firstW;
      this._layoutNode(
        node.first,
        x,
        y,
        firstW,
        h,
        leafPositions,
        splitterPositions
      );
      splitterPositions.push({
        branch: node,
        x: x + firstW,
        y,
        w: gap,
        h,
        orientation: "vertical",
      });
      this._layoutNode(
        node.second,
        x + firstW + gap,
        y,
        secondW,
        h,
        leafPositions,
        splitterPositions
      );
    } else {
      let firstH = (h - gap) * node.ratio;
      let secondH = h - gap - firstH;
      this._layoutNode(
        node.first,
        x,
        y,
        w,
        firstH,
        leafPositions,
        splitterPositions
      );
      splitterPositions.push({
        branch: node,
        x,
        y: y + firstH,
        w,
        h: gap,
        orientation: "horizontal",
      });
      this._layoutNode(
        node.second,
        x,
        y + firstH + gap,
        w,
        secondH,
        leafPositions,
        splitterPositions
      );
    }
  }

  _updateSplitters(splitterPositions) {
    this._removeSplitters();

    for (let { branch, x, y, w, h, orientation } of splitterPositions) {
      let splitter = this._document.createXULElement("hbox");
      splitter.className = "split-view-tree-splitter";
      splitter.style.position = "absolute";
      splitter.style.left = `${x}px`;
      splitter.style.top = `${y}px`;
      splitter.style.width = `${w}px`;
      splitter.style.height = `${h}px`;
      splitter.dataset.orientation = orientation;

      this._setupSplitterDrag(splitter, branch);
      this._tabpanels.appendChild(splitter);
      this._splitters.push(splitter);
    }
  }

  _setupSplitterDrag(splitterEl, branch) {
    let self = this;

    function onMouseDown(e) {
      if (e.button !== 0) {
        return;
      }
      e.preventDefault();

      let startRatio = branch.ratio;
      let isVertical = branch.orientation === "vertical";
      let startPos = isVertical ? e.clientX : e.clientY;

      let firstLeaves = [];
      let secondLeaves = [];
      self._collectLeaves(branch.first, firstLeaves);
      self._collectLeaves(branch.second, secondLeaves);

      let allRects = [...firstLeaves, ...secondLeaves]
        .map(l => self._document.getElementById(l.panelId))
        .filter(Boolean)
        .map(p => p.getBoundingClientRect());

      if (!allRects.length) {
        return;
      }

      let totalSpan;
      if (isVertical) {
        totalSpan =
          Math.max(...allRects.map(r => r.right)) -
          Math.min(...allRects.map(r => r.left));
      } else {
        totalSpan =
          Math.max(...allRects.map(r => r.bottom)) -
          Math.min(...allRects.map(r => r.top));
      }
      if (totalSpan <= 0) {
        return;
      }

      function onMouseMove(moveEvent) {
        let currentPos = isVertical ? moveEvent.clientX : moveEvent.clientY;
        let delta = currentPos - startPos;
        let newRatio = startRatio + delta / totalSpan;
        newRatio = Math.max(0.15, Math.min(0.85, newRatio));
        branch.ratio = newRatio;
        self._computeLayout();
      }

      function onMouseUp() {
        self._document.removeEventListener("mousemove", onMouseMove);
        self._document.removeEventListener("mouseup", onMouseUp);
        self._document.documentElement.style.removeProperty("user-select");
      }

      self._document.addEventListener("mousemove", onMouseMove);
      self._document.addEventListener("mouseup", onMouseUp);
      self._document.documentElement.style.userSelect = "none";
    }

    splitterEl.addEventListener("mousedown", onMouseDown);
  }

  /**
   * @param {MozTabbrowserTab} tab
   * @returns {LeafNode|null}
   */
  findLeaf(tab) {
    return this._findLeafInNode(this.root, tab);
  }

  _findLeafInNode(node, tab) {
    if (!node) {
      return null;
    }
    if (node instanceof LeafNode) {
      return node.tab === tab ? node : null;
    }
    return (
      this._findLeafInNode(node.first, tab) ||
      this._findLeafInNode(node.second, tab)
    );
  }

  /** @returns {LeafNode[]} */
  allLeaves() {
    let result = [];
    this._collectLeaves(this.root, result);
    return result;
  }

  _collectLeaves(node, result) {
    if (!node) {
      return;
    }
    if (node instanceof LeafNode) {
      result.push(node);
      return;
    }
    this._collectLeaves(node.first, result);
    this._collectLeaves(node.second, result);
  }

  /**
   * @param {LeafNode} leafNode
   * @param {"horizontal"|"vertical"} orientation
   * @returns {boolean}
   */
  canSplit(leafNode, orientation) {
    const minW = Math.floor(this._window.screen.availWidth / 4);
    const minH = Math.floor(this._window.screen.availHeight / 4);
    let panel = this._document.getElementById(leafNode.panelId);
    if (!panel) {
      return false;
    }
    const rect = panel.getBoundingClientRect();
    return orientation === "vertical"
      ? rect.width / 2 >= minW
      : rect.height / 2 >= minH;
  }

  /**
   * @param {MozTabbrowserTab} tab
   * @returns {boolean}
   */
  hasTab(tab) {
    return !!this.findLeaf(tab);
  }

  _onTabSelect(aEvent) {
    let tab = aEvent.target;
    let gBrowser = this._window.gBrowser;
    if (!gBrowser) {
      return;
    }

    if (this.hasTab(tab)) {
      this._showPanels();
      for (let leaf of this.allLeaves()) {
        leaf.tab.linkedBrowser.docShellIsActive = true;
      }
    } else {
      this._hidePanels();
      for (let leaf of this.allLeaves()) {
        leaf.tab.linkedBrowser.docShellIsActive =
          gBrowser.shouldActivateDocShell(leaf.tab.linkedBrowser);
      }
    }
  }
}
