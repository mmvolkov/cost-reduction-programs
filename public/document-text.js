// User document defaults apply only to presentation, never stored data or JSON.
export function documentText(value) {
  return String(value).replace(/ё/g, 'е').replace(/Ё/g, 'Е').replace(/[\u2010-\u2015\u2212]/g, '-');
}
