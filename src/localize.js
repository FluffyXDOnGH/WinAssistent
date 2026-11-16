const sourceText = new Map();
const sourceAttributes = new Map();
const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
while (walker.nextNode()) {
  const node = walker.currentNode;
  if (node.parentElement?.closest('script,style')) continue;
  const original = node.textContent.trim();
  if (original) sourceText.set(node, original);
}
for (const element of document.querySelectorAll('[title],[aria-label],[placeholder]')) {
  const values = {};
  for (const name of ['title', 'aria-label', 'placeholder']) {
    if (element.hasAttribute(name)) values[name] = element.getAttribute(name);
  }
  sourceAttributes.set(element, values);
}

window.localize = {
  t: (key, values) => window.app.t(key, values),
  setLanguage(value) {
    window.app.setLanguage(value);
    document.documentElement.lang = value === 'en' ? 'en' : 'de';
    for (const [node, original] of sourceText) {
      if (!node.isConnected) continue;
      const whitespace = node.textContent.match(/^\s*/)?.[0] || '';
      const suffix = node.textContent.match(/\s*$/)?.[0] || '';
      node.textContent = `${whitespace}${window.app.t(original)}${suffix}`;
    }
    for (const [element, values] of sourceAttributes) {
      if (!element.isConnected) continue;
      for (const [name, original] of Object.entries(values)) {
        element.setAttribute(name, window.app.t(original));
      }
    }
  },
};
