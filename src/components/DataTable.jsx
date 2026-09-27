import { memo, useMemo } from 'react';
import { tabulate } from '../utils/convert';
import { isContainer } from '../utils/json';

const ROW_LIMIT = 250;

function cellText(value) {
  if (value === undefined) return '';
  if (isContainer(value)) return JSON.stringify(value);
  if (typeof value === 'string') return value;
  return String(value);
}

function cellKind(value) {
  if (value === undefined) return 'missing';
  if (value === null) return 'null';
  if (isContainer(value)) return 'array';
  return typeof value;
}

/** Spreadsheet-style view of an array of records; clicking a row opens that item. */
export const DataTable = memo(function DataTable({ value, onOpenRow }) {
  const table = useMemo(() => tabulate(value), [value]);
  if (!table) return null;
  const rows = table.rows.slice(0, ROW_LIMIT);

  return (
    <div className="je-table-wrap">
      <table className="je-table">
        <thead>
          <tr>
            {!table.keyed && <th className="je-table-index">#</th>}
            {table.columns.map((column) => (
              <th key={column} title={column}>
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={String(row.key)} onClick={() => onOpenRow(row.key)} title="Open this item">
              {!table.keyed && <td className="je-table-index">{row.key}</td>}
              {row.values.map((cell, index) => (
                <td key={table.columns[index]} className={`je-v is-${cellKind(cell)}`} title={cellText(cell)}>
                  {cellText(cell)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {table.rows.length > ROW_LIMIT && (
        <p className="je-code-note">
          Showing the first {ROW_LIMIT} of {table.rows.length.toLocaleString('en-US')} rows. Export CSV to get them all.
        </p>
      )}
    </div>
  );
});
