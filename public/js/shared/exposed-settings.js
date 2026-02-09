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
    { key: 'textAlign', label: 'H-Align', inputType: 'select', options: [
      { value: 'left', label: 'Left' },
      { value: 'center', label: 'Center' },
      { value: 'right', label: 'Right' },
    ]},
    { key: 'verticalAlign', label: 'V-Align', inputType: 'select', options: [
      { value: 'top', label: 'Top' },
      { value: 'center', label: 'Center' },
      { value: 'bottom', label: 'Bottom' },
    ]},
    { key: 'textTransform', label: 'Transform', inputType: 'select', options: [
      { value: '', label: 'None' },
      { value: 'uppercase', label: 'Uppercase' },
      { value: 'lowercase', label: 'Lowercase' },
      { value: 'capitalize', label: 'Capitalize' },
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
    { key: 'carSelector', label: 'Car Selector', inputType: 'carSelector' },
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
    { key: 'textAlign', label: 'H-Align', inputType: 'select', options: [
      { value: 'left', label: 'Left' },
      { value: 'center', label: 'Center' },
      { value: 'right', label: 'Right' },
    ]},
    { key: 'verticalAlign', label: 'V-Align', inputType: 'select', options: [
      { value: 'top', label: 'Top' },
      { value: 'center', label: 'Center' },
      { value: 'bottom', label: 'Bottom' },
    ]},
    { key: 'textTransform', label: 'Transform', inputType: 'select', options: [
      { value: '', label: 'None' },
      { value: 'uppercase', label: 'Uppercase' },
      { value: 'lowercase', label: 'Lowercase' },
      { value: 'capitalize', label: 'Capitalize' },
    ]},
    { key: 'overflow', label: 'Overflow', inputType: 'select', options: [
      { value: 'hidden', label: 'Clip' },
      { value: 'visible', label: 'Visible' },
    ]},
  ],

  arcGauge: [
    { key: 'fillColor', label: 'Fill Color', inputType: 'color' },
    { key: 'bgColor', label: 'Background', inputType: 'color' },
    { key: 'carSelector', label: 'Car Selector', inputType: 'carSelector' },
    { key: 'min', label: 'Min Value', inputType: 'number', min: -10000, max: 100000, step: 1 },
    { key: 'max', label: 'Max Value', inputType: 'number', min: -10000, max: 100000, step: 1 },
    { key: 'thickness', label: 'Thickness', inputType: 'number', min: 2, max: 60, step: 1 },
  ],

  barGauge: [
    { key: 'fillColor', label: 'Fill Color', inputType: 'color' },
    { key: 'bgColor', label: 'Background', inputType: 'color' },
    { key: 'carSelector', label: 'Car Selector', inputType: 'carSelector' },
    { key: 'min', label: 'Min Value', inputType: 'number', min: -10000, max: 100000, step: 1 },
    { key: 'max', label: 'Max Value', inputType: 'number', min: -10000, max: 100000, step: 1 },
    { key: 'orientation', label: 'Direction', inputType: 'select', options: [
      { value: 'horizontal', label: 'Horizontal' },
      { value: 'vertical', label: 'Vertical' },
    ]},
  ],

  ringSegment: [
    { key: 'bgColor', label: 'Background', inputType: 'color' },
    { key: 'carSelector', label: 'Car Selector', inputType: 'carSelector' },
    { key: 'min', label: 'Min Value', inputType: 'number', min: -10000, max: 100000, step: 1 },
    { key: 'max', label: 'Max Value', inputType: 'number', min: -10000, max: 100000, step: 1 },
    { key: 'segments', label: 'Segments', inputType: 'number', min: 2, max: 60, step: 1 },
    { key: 'thickness', label: 'Thickness', inputType: 'number', min: 2, max: 60, step: 1 },
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
