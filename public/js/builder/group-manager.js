/**
 * Functions for grouping and ungrouping canvas elements.
 * Groups are identified by a shared groupId on each member element.
 */

function _uuid() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

/**
 * Group the specified elements together.
 * Assigns a new shared groupId to all specified elements.
 * @param {string[]} ids - Element IDs to group
 * @param {object[]} elements - Full elements array (mutated in place)
 * @returns {{ groupId: string, elements: object[] }} The group ID and updated array
 */
export function groupElements(ids, elements) {
  if (ids.length < 2) return { groupId: null, elements };

  const groupId = _uuid();

  for (const el of elements) {
    if (ids.includes(el.id)) {
      el.groupId = groupId;
    }
  }

  return { groupId, elements };
}

/**
 * Ungroup all elements that share the given groupId.
 * Removes the groupId from each member.
 * @param {string} groupId - The group to dissolve
 * @param {object[]} elements - Full elements array (mutated in place)
 * @returns {object[]} Updated elements array
 */
export function ungroupElement(groupId, elements) {
  if (!groupId) return elements;

  for (const el of elements) {
    if (el.groupId === groupId) {
      el.groupId = null;
    }
  }

  return elements;
}

/**
 * Get all element IDs that belong to a group.
 * @param {string} groupId
 * @param {object[]} elements
 * @returns {string[]} Array of element IDs in the group
 */
export function getGroupMembers(groupId, elements) {
  if (!groupId) return [];
  return elements.filter(el => el.groupId === groupId).map(el => el.id);
}

/**
 * Get the groupId for a given element.
 * @param {string} elementId
 * @param {object[]} elements
 * @returns {string|null}
 */
export function getElementGroupId(elementId, elements) {
  const el = elements.find(e => e.id === elementId);
  return el ? el.groupId : null;
}

/**
 * Get all unique group IDs present in the elements array.
 * @param {object[]} elements
 * @returns {string[]}
 */
export function getAllGroupIds(elements) {
  const ids = new Set();
  for (const el of elements) {
    if (el.groupId) ids.add(el.groupId);
  }
  return Array.from(ids);
}
