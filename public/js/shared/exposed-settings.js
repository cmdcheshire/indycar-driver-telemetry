/**
 * Registry of exposable settings per element type.
 * Shared between the builder (settings picker) and graphics control (operator UI).
 */

import { getCustomFontOptions } from '/js/shared/font-loader.js';

export const EXPOSABLE_SETTINGS = {
  text: [
    { key: 'text', label: 'Text Content', inputType: 'textarea' },
    { key: 'fontFamily', label: 'Font', inputType: 'select', options: [
      { value: 'Inter, sans-serif', label: 'Inter' },
      { value: 'Roboto, sans-serif', label: 'Roboto' },
      { value: 'Roboto Mono, monospace', label: 'Roboto Mono' },
      { value: 'Oswald, sans-serif', label: 'Oswald' },
      { value: 'Montserrat, sans-serif', label: 'Montserrat' },
      { value: 'Arial, sans-serif', label: 'Arial' },
    ]},
    { key: 'fontSize', label: 'Font Size', inputType: 'number', min: 8, max: 200, step: 1 },
    { key: 'fitText', label: 'Auto-size', inputType: 'select', options: [
      { value: '', label: 'Off' },
      { value: 'true', label: 'Fit to box' },
    ]},
    { key: 'fontWeight', label: 'Weight', inputType: 'select', options: [
      { value: '300', label: 'Light' },
      { value: '400', label: 'Regular' },
      { value: '500', label: 'Medium' },
      { value: '600', label: 'Semi-Bold' },
      { value: '700', label: 'Bold' },
      { value: '900', label: 'Black' },
    ]},
    { key: 'color', label: 'Color', inputType: 'color' },
    { key: 'backgroundColor', label: 'Background', inputType: 'color' },
    { key: 'textAlign', label: 'Alignment', inputType: 'select', options: [
      { value: 'left', label: 'Left' },
      { value: 'center', label: 'Center' },
      { value: 'right', label: 'Right' },
    ]},
    { key: 'overflow', label: 'Overflow', inputType: 'select', options: [
      { value: 'hidden', label: 'Clip' },
      { value: 'visible', label: 'Visible' },
    ]},
  ],

  image: [
    { key: 'src', label: 'Image Source', inputType: 'text' },
    { key: 'fit', label: 'Fit Mode', inputType: 'select', options: [
      { value: 'contain', label: 'Contain' },
      { value: 'cover', label: 'Cover' },
      { value: 'fill', label: 'Fill' },
      { value: 'none', label: 'None' },
    ]},
  ],

  shape: [
    { key: 'fill', label: 'Fill Color', inputType: 'color' },
    { key: 'strokeColor', label: 'Stroke Color', inputType: 'color' },
    { key: 'strokeWidth', label: 'Stroke Width', inputType: 'number', min: 0, max: 20, step: 1 },
    { key: 'borderRadius', label: 'Radius', inputType: 'number', min: 0, max: 100, step: 1 },
  ],

  data: [
    { key: 'fontFamily', label: 'Font', inputType: 'select', options: [
      { value: 'Inter, sans-serif', label: 'Inter' },
      { value: 'Roboto, sans-serif', label: 'Roboto' },
      { value: 'Roboto Mono, monospace', label: 'Roboto Mono' },
      { value: 'Oswald, sans-serif', label: 'Oswald' },
      { value: 'Montserrat, sans-serif', label: 'Montserrat' },
      { value: 'Arial, sans-serif', label: 'Arial' },
    ]},
    { key: 'carSelector', label: 'Car Selector', inputType: 'select', options: [
      { value: 'target1', label: 'Target Car 1' },
      { value: 'target2', label: 'Target Car 2' },
      { value: 'target3', label: 'Target Car 3' },
      { value: 'byRank:1', label: 'Position 1 (Leader)' },
      { value: 'byRank:2', label: 'Position 2' },
      { value: 'byRank:3', label: 'Position 3' },
      { value: 'byRank:4', label: 'Position 4' },
      { value: 'byRank:5', label: 'Position 5' },
      { value: 'byRank:6', label: 'Position 6' },
      { value: 'byRank:7', label: 'Position 7' },
      { value: 'byRank:8', label: 'Position 8' },
      { value: 'byRank:9', label: 'Position 9' },
      { value: 'byRank:10', label: 'Position 10' },
    ]},
    { key: 'fallback', label: 'Fallback Text', inputType: 'text' },
    { key: 'prefix', label: 'Prefix', inputType: 'text' },
    { key: 'suffix', label: 'Suffix', inputType: 'text' },
    { key: 'color', label: 'Color', inputType: 'color' },
    { key: 'backgroundColor', label: 'Background', inputType: 'color' },
    { key: 'fontSize', label: 'Font Size', inputType: 'number', min: 8, max: 200, step: 1 },
    { key: 'fitText', label: 'Auto-size', inputType: 'select', options: [
      { value: '', label: 'Off' },
      { value: 'true', label: 'Fit to box' },
    ]},
    { key: 'fontWeight', label: 'Weight', inputType: 'select', options: [
      { value: '300', label: 'Light' },
      { value: '400', label: 'Regular' },
      { value: '500', label: 'Medium' },
      { value: '600', label: 'Semi-Bold' },
      { value: '700', label: 'Bold' },
      { value: '900', label: 'Black' },
    ]},
    { key: 'overflow', label: 'Overflow', inputType: 'select', options: [
      { value: 'hidden', label: 'Clip' },
      { value: 'visible', label: 'Visible' },
    ]},
  ],
};

/**
 * Get the exposable settings for a given element type.
 * @param {string} type
 * @returns {Array<{key: string, label: string, inputType: string}>}
 */
export function getExposableSettings(type) {
  const settings = EXPOSABLE_SETTINGS[type] || [];

  // Dynamically merge custom fonts into fontFamily options
  const customFonts = getCustomFontOptions();
  if (customFonts.length === 0) return settings;

  return settings.map(s => {
    if (s.key === 'fontFamily' && s.options) {
      return { ...s, options: [...s.options, ...customFonts] };
    }
    return s;
  });
}

/**
 * Get a specific setting definition.
 * @param {string} type - Element type
 * @param {string} key - Setting key
 * @returns {object|null}
 */
export function getSettingDef(type, key) {
  const settings = EXPOSABLE_SETTINGS[type] || [];
  return settings.find(s => s.key === key) || null;
}
