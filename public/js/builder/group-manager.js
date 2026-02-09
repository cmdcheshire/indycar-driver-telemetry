/**
 * Group Manager — manages hierarchical groups of canvas elements.
 *
 * Groups are first-class objects stored in their own array (separate from
 * elements). Each element has a `groupId` property that points to the group
 * it belongs to (or null for root-level elements). Groups can be nested
 * via `parentGroupId`.
 *
 * All mutating functions work directly on the arrays / objects passed in
 * (no copies) and return useful values for the caller.
 */

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Generate a UUID — works in non-secure (HTTP) contexts. */
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
 * Create a new group data object with sensible defaults.
 * @param {string} name
 * @param {string|null} parentGroupId
 * @returns {object}
 */
function _createGroupObject(name, parentGroupId = null) {
  return {
    id: _uuid(),
    name: name || 'Group',
    parentGroupId,
    visible: true,
    locked: false,
    expanded: true,
    animation: {
      enter: { type: 'none', duration: 300, delay: 0, easing: 'power2.out' },
      exit:  { type: 'none', duration: 300, delay: 0, easing: 'power2.in' },
    },
  };
}

/**
 * Collect all descendant group IDs (children, grandchildren, ...) of a group.
 * @param {string} groupId
 * @param {object[]} groups
 * @returns {string[]}
 */
function _getDescendantGroupIds(groupId, groups) {
  const descendants = [];
  const queue = [groupId];

  while (queue.length) {
    const currentId = queue.shift();
    const children = groups.filter(g => g.parentGroupId === currentId);
    for (const child of children) {
      descendants.push(child.id);
      queue.push(child.id);
    }
  }

  return descendants;
}

/**
 * Check whether `candidateAncestorId` is an ancestor of `groupId`.
 * Used to prevent circular nesting.
 * @param {string} groupId
 * @param {string} candidateAncestorId
 * @param {object[]} groups
 * @returns {boolean}
 */
function _isAncestor(groupId, candidateAncestorId, groups) {
  let current = groups.find(g => g.id === groupId);
  while (current && current.parentGroupId) {
    if (current.parentGroupId === candidateAncestorId) return true;
    current = groups.find(g => g.id === current.parentGroupId);
  }
  return false;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Create a new group from selected element IDs.
 * Sets `groupId` on each element.
 * @param {string} name
 * @param {string[]} elementIds
 * @param {object[]} elements
 * @param {object[]} groups
 * @returns {object} The newly created group object.
 */
export function createGroup(name, elementIds, elements, groups) {
  // Determine a common parent: if every selected element shares the same
  // groupId we nest inside that group; otherwise the new group is root-level.
  const selectedElements = elements.filter(el => elementIds.includes(el.id));
  const parentIds = [...new Set(selectedElements.map(el => el.groupId))];
  const parentGroupId = parentIds.length === 1 ? parentIds[0] : null;

  const group = _createGroupObject(name, parentGroupId);
  groups.push(group);

  for (const el of selectedElements) {
    el.groupId = group.id;
  }

  return group;
}

/**
 * Create an empty group (folder) at root level or inside a parent group.
 * @param {string} name
 * @param {string|null} parentGroupId
 * @param {object[]} groups
 * @returns {object} The newly created group object.
 */
export function createEmptyGroup(name, parentGroupId, groups) {
  const group = _createGroupObject(name, parentGroupId);
  groups.push(group);
  return group;
}

/**
 * Delete a group. Elements inside get re-parented to the group's parent
 * (or null). Child groups are also re-parented to the deleted group's parent.
 * @param {string} groupId
 * @param {object[]} elements
 * @param {object[]} groups
 * @returns {void}
 */
export function deleteGroup(groupId, elements, groups) {
  const group = groups.find(g => g.id === groupId);
  if (!group) return;

  const newParent = group.parentGroupId || null;

  // Re-parent direct child elements
  for (const el of elements) {
    if (el.groupId === groupId) {
      el.groupId = newParent;
    }
  }

  // Re-parent direct child groups
  for (const g of groups) {
    if (g.parentGroupId === groupId) {
      g.parentGroupId = newParent;
    }
  }

  // Remove the group itself
  const idx = groups.findIndex(g => g.id === groupId);
  if (idx !== -1) groups.splice(idx, 1);
}

/**
 * Rename a group.
 * @param {string} groupId
 * @param {string} newName
 * @param {object[]} groups
 * @returns {void}
 */
export function renameGroup(groupId, newName, groups) {
  const group = groups.find(g => g.id === groupId);
  if (group) group.name = newName;
}

/**
 * Move a group to be a child of another group (or root if parentId is null).
 * Prevents circular references.
 * @param {string} groupId
 * @param {string|null} newParentGroupId
 * @param {object[]} groups
 * @returns {boolean} True if the move succeeded.
 */
export function moveGroup(groupId, newParentGroupId, groups) {
  if (groupId === newParentGroupId) return false;

  const group = groups.find(g => g.id === groupId);
  if (!group) return false;

  // Prevent circular nesting: newParent cannot be a descendant of groupId
  if (newParentGroupId !== null) {
    const descendants = _getDescendantGroupIds(groupId, groups);
    if (descendants.includes(newParentGroupId)) return false;
  }

  group.parentGroupId = newParentGroupId;
  return true;
}

/**
 * Move an element into a group (set its groupId).
 * @param {string} elementId
 * @param {string} groupId
 * @param {object[]} elements
 * @returns {void}
 */
export function moveElementToGroup(elementId, groupId, elements) {
  const el = elements.find(e => e.id === elementId);
  if (el) el.groupId = groupId;
}

/**
 * Remove an element from its group (set groupId to null).
 * @param {string} elementId
 * @param {object[]} elements
 * @returns {void}
 */
export function removeElementFromGroup(elementId, elements) {
  const el = elements.find(e => e.id === elementId);
  if (el) el.groupId = null;
}

/**
 * Toggle group expanded / collapsed state.
 * @param {string} groupId
 * @param {object[]} groups
 * @returns {boolean} The new expanded state.
 */
export function toggleGroupExpanded(groupId, groups) {
  const group = groups.find(g => g.id === groupId);
  if (!group) return false;
  group.expanded = !group.expanded;
  return group.expanded;
}

/**
 * Toggle group visibility. Cascades to all descendant groups and their
 * direct elements.
 * @param {string} groupId
 * @param {object[]} elements
 * @param {object[]} groups
 * @returns {boolean} The new visibility state of the toggled group.
 */
export function toggleGroupVisibility(groupId, elements, groups) {
  const group = groups.find(g => g.id === groupId);
  if (!group) return false;

  const newVisible = !group.visible;
  group.visible = newVisible;

  // Collect this group + all descendants
  const affectedGroupIds = [groupId, ..._getDescendantGroupIds(groupId, groups)];

  // Set all descendant groups to the same visibility
  for (const gid of affectedGroupIds) {
    const g = groups.find(gr => gr.id === gid);
    if (g) g.visible = newVisible;
  }

  // Set all elements belonging to any affected group
  for (const el of elements) {
    if (el.groupId && affectedGroupIds.includes(el.groupId)) {
      el.visible = newVisible;
    }
  }

  return newVisible;
}

/**
 * Toggle group locked state. Cascades to all descendant groups and their
 * direct elements.
 * @param {string} groupId
 * @param {object[]} elements
 * @param {object[]} groups
 * @returns {boolean} The new locked state of the toggled group.
 */
export function toggleGroupLocked(groupId, elements, groups) {
  const group = groups.find(g => g.id === groupId);
  if (!group) return false;

  const newLocked = !group.locked;
  group.locked = newLocked;

  // Collect this group + all descendants
  const affectedGroupIds = [groupId, ..._getDescendantGroupIds(groupId, groups)];

  // Set all descendant groups to the same lock state
  for (const gid of affectedGroupIds) {
    const g = groups.find(gr => gr.id === gid);
    if (g) g.locked = newLocked;
  }

  // Set all elements belonging to any affected group
  for (const el of elements) {
    if (el.groupId && affectedGroupIds.includes(el.groupId)) {
      el.locked = newLocked;
    }
  }

  return newLocked;
}

/**
 * Get all element IDs that belong to a group (direct children only).
 * @param {string} groupId
 * @param {object[]} elements
 * @returns {string[]}
 */
export function getGroupMembers(groupId, elements) {
  if (!groupId) return [];
  return elements.filter(el => el.groupId === groupId).map(el => el.id);
}

/**
 * Get all element IDs that belong to a group and all its descendant groups
 * (recursive).
 * @param {string} groupId
 * @param {object[]} elements
 * @param {object[]} groups
 * @returns {string[]}
 */
export function getAllGroupDescendantElements(groupId, elements, groups) {
  const allGroupIds = [groupId, ..._getDescendantGroupIds(groupId, groups)];
  return elements
    .filter(el => el.groupId && allGroupIds.includes(el.groupId))
    .map(el => el.id);
}

/**
 * Get direct child groups of a group (or root groups if groupId is null).
 * @param {string|null} groupId
 * @param {object[]} groups
 * @returns {object[]}
 */
export function getChildGroups(groupId, groups) {
  return groups.filter(g => g.parentGroupId === groupId);
}

/**
 * Get all ancestor group IDs for an element (from its group up to root).
 * Returned in order from immediate parent to top-most ancestor.
 * @param {string} elementId
 * @param {object[]} elements
 * @param {object[]} groups
 * @returns {string[]}
 */
export function getElementAncestorGroups(elementId, elements, groups) {
  const el = elements.find(e => e.id === elementId);
  if (!el || !el.groupId) return [];

  const ancestors = [];
  let currentGroupId = el.groupId;

  while (currentGroupId) {
    ancestors.push(currentGroupId);
    const currentGroup = groups.find(g => g.id === currentGroupId);
    currentGroupId = currentGroup ? currentGroup.parentGroupId : null;
  }

  return ancestors;
}

/**
 * Build a tree structure for rendering the layer panel.
 *
 * Returns an array of nodes at the root level. Each node is either:
 *   - `{ type: 'element', element }` for a root-level element
 *   - `{ type: 'group', group, children: [...] }` for a group
 *
 * Within each level, groups are sorted alphabetically by name and elements
 * are sorted by descending zIndex (highest z-index first, matching a
 * typical "top of stack = top of list" convention).
 *
 * @param {object[]} elements
 * @param {object[]} groups
 * @returns {Array<{type: string, element?: object, group?: object, children?: Array}>}
 */
export function buildLayerTree(elements, groups) {
  /**
   * Recursively build children for a given parent group ID.
   * @param {string|null} parentId - null for root level
   */
  function buildChildren(parentId) {
    const nodes = [];

    // Collect child groups at this level
    const childGroups = groups
      .filter(g => (g.parentGroupId ?? null) === parentId)
      .sort((a, b) => a.name.localeCompare(b.name));

    for (const group of childGroups) {
      nodes.push({
        type: 'group',
        group,
        children: buildChildren(group.id),
      });
    }

    // Collect elements at this level
    const childElements = elements
      .filter(el => (el.groupId || null) === parentId)
      .sort((a, b) => (b.zIndex ?? 0) - (a.zIndex ?? 0));

    for (const element of childElements) {
      nodes.push({
        type: 'element',
        element,
      });
    }

    return nodes;
  }

  return buildChildren(null);
}

/**
 * Find a group by ID.
 * @param {string} groupId
 * @param {object[]} groups
 * @returns {object|undefined}
 */
export function getGroup(groupId, groups) {
  return groups.find(g => g.id === groupId);
}

/**
 * Get all unique group IDs.
 * @param {object[]} groups
 * @returns {string[]}
 */
export function getAllGroupIds(groups) {
  return groups.map(g => g.id);
}

/**
 * Ungroup: dissolve a group. Elements move to the parent group (or root).
 * Child groups are also re-parented to the dissolved group's parent.
 * The group is then removed.
 * @param {string} groupId
 * @param {object[]} elements
 * @param {object[]} groups
 * @returns {void}
 */
export function ungroupElements(groupId, elements, groups) {
  // Delegate to deleteGroup — the behaviour is identical: re-parent
  // children and remove the group.
  deleteGroup(groupId, elements, groups);
}
