/**
 * ui/components/DataTable.js — generic sortable table (CONTRACTS-UI §6).
 * Phase 3 (UI shell). Pure props -> VNode; emits the `.table` BEM classes from
 * styles/main.css. The leaders + box score views build on this.
 */

import { h, classNames } from '../render.js';

/**
 * @typedef {object} DataColumn
 * @property {string} key            unique column key (matches a row field unless `value` given)
 * @property {string} [label]        header text (defaults to key)
 * @property {boolean} [numeric]     right-align + mono (`.table__cell--num`)
 * @property {boolean} [sortable]    show a sort button in the header
 * @property {(row:object)=>*} [value]  cell value accessor (defaults to row[key])
 * @property {(row:object)=>*} [render] cell content renderer (defaults to the value)
 */

/**
 * Generic sortable table.
 *
 * @param {object} props
 * @param {DataColumn[]} props.columns       column descriptors
 * @param {object[]} props.rows              row data (already sorted by the caller)
 * @param {string} [props.sortKey]           active sort column key
 * @param {'asc'|'desc'} [props.sortDir]     active sort direction
 * @param {(key:string)=>void} [props.onSort] header click handler (key)
 * @param {(row:object,index:number)=>string} [props.rowKey] stable key per row
 * @param {(row:object,index:number)=>(string|false|null|undefined)} [props.rowClass]
 *        optional extra class per row (e.g. followed-team emphasis)
 * @param {(row:object,index:number)=>void} [props.onRow] optional row click handler
 * @param {string} [props.class]             extra wrapper class on the <table>
 * @returns {*} VNode
 */
export function DataTable(props) {
  const {
    columns = [],
    rows = [],
    sortKey = null,
    sortDir = 'desc',
    onSort = null,
    rowKey = null,
    rowClass = null,
    onRow = null,
    class: extraClass = ''
  } = props || {};

  const head = h(
    'thead',
    { class: 'table__head' },
    h(
      'tr',
      { class: 'table__row' },
      columns.map((col) => headerCell(col, sortKey, sortDir, onSort))
    )
  );

  const body = h(
    'tbody',
    null,
    rows.map((row, i) => {
      const key = rowKey ? String(rowKey(row, i)) : String(i);
      const extra = rowClass ? rowClass(row, i) : null;
      return h(
        'tr',
        {
          key,
          class: classNames('table__row', onRow && 'table__row--clickable', extra),
          onClick: onRow ? () => onRow(row, i) : undefined
        },
        columns.map((col) => bodyCell(col, row))
      );
    })
  );

  return h('table', { class: classNames('table', extraClass) }, head, body);
}

/** Build a header cell (a sort button when the column is sortable + onSort exists). */
function headerCell(col, sortKey, sortDir, onSort) {
  const label = col.label != null ? col.label : col.key;
  const cls = classNames('table__cell', col.numeric && 'table__cell--num');

  if (col.sortable && onSort) {
    const active = sortKey === col.key;
    return h(
      'th',
      { key: col.key, class: cls, scope: 'col' },
      h(
        'button',
        {
          type: 'button',
          class: classNames(
            'table__sort',
            active && 'table__sort--active',
            active && `table__sort--${sortDir}`
          ),
          onClick: () => onSort(col.key)
        },
        label
      )
    );
  }

  return h('th', { key: col.key, class: cls, scope: 'col' }, label);
}

/** Build a body cell, using `render` then `value` then row[key]. */
function bodyCell(col, row) {
  const cls = classNames('table__cell', col.numeric && 'table__cell--num');
  let content;
  if (typeof col.render === 'function') content = col.render(row);
  else if (typeof col.value === 'function') content = col.value(row);
  else content = row[col.key];
  if (content === null || content === undefined) content = '';
  return h('td', { key: col.key, class: cls }, content);
}
