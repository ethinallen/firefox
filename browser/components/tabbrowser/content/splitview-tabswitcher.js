/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// eslint-disable-next-line no-unused-vars
var splitViewTabSwitcher = {
  _panel: null,
  _tablist: null,
  _filteredTabs: [],
  _selectedIndex: -1,
  _boundOnKeyDown: null,

  get panel() {
    if (!this._panel) {
      this._panel = document.getElementById("splitViewTabSwitcher-panel");
    }
    return this._panel;
  },

  get tablist() {
    if (!this._tablist) {
      this._tablist = document.getElementById("splitViewTabSwitcher-tablist");
    }
    return this._tablist;
  },

  get isOpen() {
    return this.panel.state === "open" || this.panel.state === "showing";
  },

  get focusedLeaf() {
    return gBrowser._focusedSplitPane;
  },

  toggle() {
    if (!gBrowser._splitTree || !this.focusedLeaf) {
      return;
    }
    if (this.isOpen) {
      this.close();
    } else {
      this.open();
    }
  },

  open() {
    if (!gBrowser._splitTree || !this.focusedLeaf) {
      return;
    }

    this._buildFilteredTabs();
    this._renderTabList();

    let anchor = this._getAnchorElement();
    if (!anchor) {
      return;
    }

    this.panel.hidden = false;
    this.panel.addEventListener("popuphidden", this);
    this.panel.addEventListener("popupshown", this);
    this.panel.openPopup(anchor, "start_before", 0, 0, false, false);
  },

  close() {
    this.panel.hidePopup();
  },

  /**
   * Cycle through tabs in the filtered list.
   *
   * @param {boolean} forward - true to go down, false to go up.
   */
  cycleTab(forward) {
    if (!gBrowser._splitTree || !this.focusedLeaf) {
      return;
    }

    if (!this._filteredTabs.length) {
      this._buildFilteredTabs();
    }
    if (this._filteredTabs.length <= 1) {
      return;
    }

    if (this._selectedIndex < 0) {
      let currentTab = this.focusedLeaf.tab;
      this._selectedIndex = this._filteredTabs.indexOf(currentTab);
    }

    if (forward) {
      this._selectedIndex =
        (this._selectedIndex + 1) % this._filteredTabs.length;
    } else {
      this._selectedIndex =
        (this._selectedIndex - 1 + this._filteredTabs.length) %
        this._filteredTabs.length;
    }

    if (this.isOpen) {
      this._updateSelection();
    } else {
      let newTab = this._filteredTabs[this._selectedIndex];
      if (newTab && newTab !== this.focusedLeaf.tab) {
        this._swapTabIntoPane(newTab);
      }
    }
  },

  pick(tab) {
    if (tab && tab !== this.focusedLeaf?.tab) {
      this._swapTabIntoPane(tab);
    }
    this.close();
  },

  _buildFilteredTabs() {
    let allLeaves = gBrowser._splitTree.allLeaves();
    let focusedLeaf = this.focusedLeaf;
    let otherPaneTabs = new Set(
      allLeaves.filter(l => l !== focusedLeaf).map(l => l.tab)
    );

    this._filteredTabs = gBrowser.visibleTabs.filter(
      t => !otherPaneTabs.has(t)
    );

    let currentTab = focusedLeaf.tab;
    this._selectedIndex = this._filteredTabs.indexOf(currentTab);
  },

  _renderTabList() {
    while (this.tablist.firstChild) {
      this.tablist.firstChild.remove();
    }

    let currentTab = this.focusedLeaf?.tab;
    for (let i = 0; i < this._filteredTabs.length; i++) {
      let row = this._createTabRow(this._filteredTabs[i], i, currentTab);
      this.tablist.appendChild(row);
    }
  },

  _createTabRow(tab, index, currentTab) {
    let row = document.createXULElement("hbox");
    row.className = "splitViewTabSwitcher-row";
    row.setAttribute("data-index", index);

    if (tab === currentTab) {
      row.setAttribute("current", "true");
    }
    if (index === this._selectedIndex) {
      row.setAttribute("selected", "true");
    }

    let icon = document.createXULElement("image");
    icon.className = "splitViewTabSwitcher-icon";
    icon.setAttribute(
      "src",
      tab.image || "chrome://global/skin/icons/defaultFavicon.svg"
    );

    let label = document.createXULElement("label");
    label.className = "splitViewTabSwitcher-label";
    label.setAttribute("value", tab.label);
    label.setAttribute("crop", "end");

    row.appendChild(icon);
    row.appendChild(label);

    row.addEventListener("click", this);
    row.addEventListener("mouseover", this);

    return row;
  },

  _updateSelection() {
    let rows = this.tablist.querySelectorAll(".splitViewTabSwitcher-row");
    for (let row of rows) {
      if (parseInt(row.getAttribute("data-index")) === this._selectedIndex) {
        row.setAttribute("selected", "true");
        row.scrollIntoView({ block: "nearest" });
      } else {
        row.removeAttribute("selected");
      }
    }
  },

  _swapTabIntoPane(newTab) {
    let leaf = this.focusedLeaf;
    if (!leaf) {
      return;
    }

    let oldTab = leaf.tab;

    gBrowser._removeSplitTreeFocusListeners([leaf]);

    oldTab.linkedBrowser.docShellIsActive = false;

    gBrowser._insertBrowser(newTab);

    gBrowser._splitTree.replaceLeafTab(leaf, newTab);

    newTab.linkedBrowser.docShellIsActive = true;

    gBrowser._addSplitTreeFocusListeners([leaf]);

    gBrowser.selectedTab = newTab;
  },

  _getAnchorElement() {
    let leaf = this.focusedLeaf;
    if (!leaf) {
      return null;
    }
    let panel = document.getElementById(leaf.panelId);
    if (!panel) {
      return null;
    }
    return panel.querySelector(".browserContainer") || panel;
  },

  handleEvent(event) {
    switch (event.type) {
      case "click": {
        let row = event.target.closest(".splitViewTabSwitcher-row");
        if (row) {
          let index = parseInt(row.getAttribute("data-index"));
          let tab = this._filteredTabs[index];
          if (tab) {
            this.pick(tab);
          }
        }
        break;
      }
      case "mouseover": {
        let row = event.target.closest(".splitViewTabSwitcher-row");
        if (row) {
          let index = parseInt(row.getAttribute("data-index"));
          this._selectedIndex = index;
          this._updateSelection();
        }
        break;
      }
      case "popupshown":
        this._boundOnKeyDown = this._onKeyDown.bind(this);
        document.addEventListener("keydown", this._boundOnKeyDown, true);
        break;
      case "popuphidden": {
        if (this._boundOnKeyDown) {
          document.removeEventListener("keydown", this._boundOnKeyDown, true);
          this._boundOnKeyDown = null;
        }
        this.panel.removeEventListener("popuphidden", this);
        this.panel.removeEventListener("popupshown", this);
        this._filteredTabs = [];
        this._selectedIndex = -1;
        this.panel.hidden = true;

        let browser = gBrowser.selectedBrowser;
        if (browser) {
          browser.focus();
        }
        break;
      }
    }
  },

  _onKeyDown(event) {
    switch (event.key) {
      case "Escape":
        event.preventDefault();
        event.stopPropagation();
        this.close();
        break;
      case "Enter":
        event.preventDefault();
        event.stopPropagation();
        if (
          this._selectedIndex >= 0 &&
          this._selectedIndex < this._filteredTabs.length
        ) {
          this.pick(this._filteredTabs[this._selectedIndex]);
        }
        break;
      case "ArrowDown":
        event.preventDefault();
        event.stopPropagation();
        this.cycleTab(true);
        break;
      case "ArrowUp":
        event.preventDefault();
        event.stopPropagation();
        this.cycleTab(false);
        break;
    }
  },
};
