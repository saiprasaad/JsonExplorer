import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import Dialog from '@mui/material/Dialog';
import { ALT_KEY, MOD_KEY, SHIFT_KEY } from '../utils/platform';

const GROUPS = [
  {
    title: 'General',
    items: [
      [[ALT_KEY, '1'], 'Graph view'],
      [[ALT_KEY, '2'], 'Tree view'],
      [[ALT_KEY, '3'], 'Compare view'],
      [[MOD_KEY, 'O'], 'Open a JSON file'],
      [[MOD_KEY, 'S'], 'Download the JSON'],
      [['?'], 'Show this help'],
    ],
  },
  {
    title: 'Editor',
    items: [
      [[MOD_KEY, SHIFT_KEY, 'F'], 'Format JSON'],
      [[MOD_KEY, SHIFT_KEY, 'M'], 'Minify JSON'],
      [[MOD_KEY, 'F'], 'Find in editor'],
      [[MOD_KEY, 'H'], 'Find and replace'],
      [[MOD_KEY, 'Z'], 'Undo (works for Format, Sort and Repair too)'],
    ],
  },
  {
    title: 'Graph & tree',
    items: [
      [['/'], 'Search the document'],
      [['Enter'], 'Next search result'],
      [[SHIFT_KEY, 'Enter'], 'Previous search result'],
      [['←', '→', '↑', '↓'], 'Move between nodes'],
      [['Space'], 'Expand or collapse the selected node'],
      [['F'], 'Fit graph to screen'],
      [['Esc'], 'Clear selection / close panel'],
    ],
  },
];

export function ShortcutsDialog({ open, onClose }) {
  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth aria-labelledby="je-shortcuts-title">
      <div className="je-dialog">
        <div className="je-dialog-header">
          <h2 id="je-shortcuts-title">Keyboard shortcuts</h2>
          <button type="button" className="je-icon-btn" aria-label="Close" onClick={onClose}>
            <CloseRoundedIcon fontSize="small" />
          </button>
        </div>
        <div className="je-shortcuts">
          {GROUPS.map((group) => (
            <section key={group.title}>
              <h3>{group.title}</h3>
              <dl>
                {group.items.map(([keys, description]) => (
                  <div key={description} className="je-shortcut-row">
                    <dt>
                      {keys.map((key) => (
                        <kbd key={key}>{key}</kbd>
                      ))}
                    </dt>
                    <dd>{description}</dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
      </div>
    </Dialog>
  );
}
