// SPDX-License-Identifier: GPL-3.0-or-later
// Colours of label stock and ink, for the preview: [name, hex]. Clear has
// no colour of its own (it is drawn see-through). Used by the Label colour
// and Ink colour menus and by catalogue records whose roll has fixed colours
// (LabelColor, InkColor in catalog/media.rec).
export const LABEL_COLORS = {
  white: ['White', '#ffffff'], clear: ['Clear', null], yellow: ['Yellow', '#f6d32b'], orange: ['Orange', '#ff7b22'],
  red: ['Red', '#d8352f'], pink: ['Pink', '#f29abf'], blue: ['Blue', '#2468c9'], green: ['Green', '#2f9e55'],
  silver: ['Silver', '#c3c6ca'], gold: ['Gold', '#c9a54b'], black: ['Black', '#151515'],
};
export const INK_COLORS = {
  black: ['Black', '#111111'], white: ['White', '#ffffff'], red: ['Red', '#d8352f'], blue: ['Blue', '#2468c9'], gold: ['Gold', '#b8902e'],
};
