const dictionaries = {
  de: require('../locales/de.json'),
  en: require('../locales/en.json'),
};

function language(value) {
  return Object.hasOwn(dictionaries, value) ? value : 'de';
}

function translate(locale, key, values = {}) {
  const text = dictionaries[language(locale)][key] ?? dictionaries.de[key] ?? key;
  return text.replace(/\{(\w+)\}/g, (match, name) => String(values[name] ?? match));
}

module.exports = { dictionaries, language, translate };
