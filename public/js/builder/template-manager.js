/**
 * Template persistence manager.
 * Handles save, load, list, duplicate, and delete operations via the REST API.
 */

import { authenticatedFetch } from '/js/modules/auth.js';

const API_BASE = '/api/overlays/templates';

export class TemplateManager {
  /** @type {string|null} Current template ID (null for new/unsaved) */
  #currentId = null;

  /** @returns {string|null} */
  get currentId() {
    return this.#currentId;
  }

  /** @param {string|null} id */
  set currentId(id) {
    this.#currentId = id;
  }

  /**
   * Save (create or update) a template.
   * @param {string} name - Template name
   * @param {string} type - Template type (leaderboard, driver_card, etc.)
   * @param {object[]} elements - Array of element objects
   * @param {string[]} groups - Array of group IDs
   * @param {number} canvasW - Canvas width in px
   * @param {number} canvasH - Canvas height in px
   * @returns {Promise<object>} Saved template data
   */
  async save(name, type, elements, groups, canvasW = 1920, canvasH = 1080) {
    const payload = {
      name,
      overlay_type: type,
      template_data: {
        elements,
        groups,
        canvas: { width: canvasW, height: canvasH },
        version: 1,
      },
      canvas_width: canvasW,
      canvas_height: canvasH,
    };

    let res;
    if (this.#currentId) {
      // Update existing template
      res = await authenticatedFetch(`${API_BASE}/${this.#currentId}`, {
        method: 'PUT',
        body: JSON.stringify(payload),
      });
    } else {
      // Create new template
      res = await authenticatedFetch(API_BASE, {
        method: 'POST',
        body: JSON.stringify(payload),
      });
    }

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || `Failed to save template (${res.status})`);
    }

    const result = await res.json();

    // Store the ID so subsequent saves are updates
    if (result.id) {
      this.#currentId = result.id;
    } else if (result.template?.id) {
      this.#currentId = result.template.id;
    }

    return result;
  }

  /**
   * Load a template by ID.
   * @param {string} id - Template ID
   * @returns {Promise<{ name: string, type: string, elements: object[], groups: string[], canvas: object }>}
   */
  async load(id) {
    const res = await authenticatedFetch(`${API_BASE}/${id}`);

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || `Failed to load template (${res.status})`);
    }

    const data = await res.json();
    const template = data.template || data;
    this.#currentId = template.id || id;

    // Parse template_data if it's a string
    let templateData = template.template_data;
    if (typeof templateData === 'string') {
      templateData = JSON.parse(templateData);
    }

    return {
      id: this.#currentId,
      name: template.name,
      type: template.overlay_type || template.type,
      elements: templateData?.elements || [],
      groups: templateData?.groups || [],
      canvas: templateData?.canvas || { width: 1920, height: 1080 },
    };
  }

  /**
   * List all available templates.
   * @returns {Promise<object[]>} Array of template summaries
   */
  async list() {
    const res = await authenticatedFetch(API_BASE);

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || `Failed to list templates (${res.status})`);
    }

    const data = await res.json();
    return Array.isArray(data) ? data : data.templates || [];
  }

  /**
   * Duplicate a template.
   * @param {string} id - Template ID to duplicate
   * @returns {Promise<object>} The new duplicated template
   */
  async duplicate(id) {
    const res = await authenticatedFetch(`${API_BASE}/${id}/duplicate`, {
      method: 'POST',
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || `Failed to duplicate template (${res.status})`);
    }

    return await res.json();
  }

  /**
   * Delete a template.
   * @param {string} id - Template ID to delete
   * @returns {Promise<void>}
   */
  async delete(id) {
    const res = await authenticatedFetch(`${API_BASE}/${id}`, {
      method: 'DELETE',
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || `Failed to delete template (${res.status})`);
    }

    // Clear current ID if we just deleted the loaded template
    if (this.#currentId === id) {
      this.#currentId = null;
    }
  }
}
