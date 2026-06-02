const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

class ClassList {
  constructor() {
    this.values = new Set();
  }

  toggle(name, enabled) {
    if (enabled) {
      this.values.add(name);
    } else {
      this.values.delete(name);
    }
  }
}

class Element {
  constructor(tagName, documentRef) {
    this.tagName = tagName.toLowerCase();
    this.ownerDocument = documentRef;
    this.children = [];
    this.parentElement = null;
    this.style = {};
    this.dataset = {};
    this.classList = new ClassList();
    this.attributes = {};
    this.eventListeners = {};
    this.textContent = '';
    this._id = '';
  }

  get id() {
    return this._id;
  }

  set id(value) {
    this._id = value || '';
    if (this._id) {
      this.ownerDocument.elementsById.set(this._id, this);
    }
  }

  get isConnected() {
    let current = this;
    while (current) {
      if (current === this.ownerDocument.root) {
        return true;
      }
      current = current.parentElement;
    }
    return false;
  }

  get previousElementSibling() {
    if (!this.parentElement) {
      return null;
    }
    const siblings = this.parentElement.children;
    const index = siblings.indexOf(this);
    return index > 0 ? siblings[index - 1] : null;
  }

  set href(value) {
    this.attributes.href = value;
  }

  get href() {
    return this.attributes.href;
  }

  appendChild(child) {
    child.parentElement = this;
    this.children.push(child);
    return child;
  }

  after(node) {
    if (!this.parentElement) {
      return;
    }
    if (node.parentElement) {
      const oldSiblings = node.parentElement.children;
      const oldIndex = oldSiblings.indexOf(node);
      if (oldIndex !== -1) {
        oldSiblings.splice(oldIndex, 1);
      }
    }
    node.parentElement = this.parentElement;
    const siblings = this.parentElement.children;
    siblings.splice(siblings.indexOf(this) + 1, 0, node);
  }

  closest(selector) {
    let current = this;
    while (current) {
      if (matchesSelector(current, selector)) {
        return current;
      }
      current = current.parentElement;
    }
    return null;
  }

  querySelector(selector) {
    return findFirst(this, selector);
  }

  addEventListener(type, handler) {
    this.eventListeners[type] = handler;
  }
}

class Document {
  constructor() {
    this.elementsById = new Map();
    this.root = new Element('document', this);
  }

  createElement(tagName) {
    return new Element(tagName, this);
  }

  getElementById(id) {
    return this.elementsById.get(id) || null;
  }

  querySelector(selector) {
    return findFirst(this.root, selector);
  }
}

function matchesSelector(element, selector) {
  if (selector.startsWith('#')) {
    return element.id === selector.slice(1);
  }
  return element.tagName === selector.toLowerCase();
}

function findFirst(root, selector) {
  const stack = [...root.children];
  while (stack.length) {
    const current = stack.shift();
    if (matchesSelector(current, selector)) {
      return current;
    }
    stack.unshift(...current.children);
  }
  return null;
}

function append(parent, child) {
  parent.appendChild(child);
  return child;
}

function buildDocument() {
  const documentRef = new Document();
  const nav = append(documentRef.root, documentRef.createElement('nav'));
  const collapsible = append(nav, documentRef.createElement('div'));
  collapsible.id = 'nav-collapsible';
  const navList = append(collapsible, documentRef.createElement('ul'));

  const homeLi = append(navList, documentRef.createElement('li'));
  const homeLink = append(homeLi, documentRef.createElement('a'));
  homeLink.id = 'home-link';

  const motdLi = append(navList, documentRef.createElement('li'));
  const motdLink = append(motdLi, documentRef.createElement('a'));
  motdLink.id = 'navbar-motd-toggle';

  const toolsContainer = append(documentRef.root, documentRef.createElement('div'));
  toolsContainer.id = 'tools-button-container';

  return { documentRef, navList, motdLi };
}

function runScript(documentRef) {
  const scriptPath = path.join(__dirname, '..', 'World Clock Toggle.js');
  const code = fs.readFileSync(scriptPath, 'utf8');

  const context = {
    document: documentRef,
    window: {
      CytubeWorldClockToggleUtils: {
        parseBoolean(value, fallback) {
          return typeof value === 'boolean' ? value : fallback;
        },
      },
    },
    GM_addStyle() {},
    GM_getResourceText() {
      return '';
    },
    GM_getValue() {
      return true;
    },
    GM_setValue() {},
    Intl,
    Date,
    setInterval() {
      return 1;
    },
    clearInterval() {},
    setTimeout() {},
  };

  vm.runInNewContext(code, context, { filename: scriptPath });
}

const { documentRef, navList, motdLi } = buildDocument();
runScript(documentRef);

const clockLi = documentRef.getElementById('world-clock-li');
assert(clockLi, 'world clock navbar item should be created');
assert.strictEqual(clockLi.previousElementSibling, motdLi, 'clock should be inserted after navbar MOTD item');
assert.strictEqual(clockLi.style.display, 'list-item', 'clock should be visible when stored setting is true');
assert.strictEqual(navList.children.includes(clockLi), true, 'clock should remain inside the navbar list');
