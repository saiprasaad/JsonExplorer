import ContentCopyRoundedIcon from '@mui/icons-material/ContentCopyRounded';
import FitScreenRoundedIcon from '@mui/icons-material/FitScreenRounded';
import ImageRoundedIcon from '@mui/icons-material/ImageRounded';
import MapRoundedIcon from '@mui/icons-material/MapRounded';
import MyLocationRoundedIcon from '@mui/icons-material/MyLocationRounded';
import SouthRoundedIcon from '@mui/icons-material/SouthRounded';
import EastRoundedIcon from '@mui/icons-material/EastRounded';
import UnfoldLessRoundedIcon from '@mui/icons-material/UnfoldLessRounded';
import UnfoldMoreRoundedIcon from '@mui/icons-material/UnfoldMoreRounded';
import ZoomInRoundedIcon from '@mui/icons-material/ZoomInRounded';
import ZoomOutRoundedIcon from '@mui/icons-material/ZoomOutRounded';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import { useState } from 'react';
import { ToolButton } from '../ToolButton';

export function GraphToolbar({
  direction,
  onToggleDirection,
  onZoomIn,
  onZoomOut,
  onFit,
  onExpandAll,
  onCollapseAll,
  showMinimap,
  onToggleMinimap,
  followCursor,
  onToggleFollowCursor,
  onExport,
  compact,
}) {
  const [exportAnchor, setExportAnchor] = useState(null);
  const runExport = (format) => {
    setExportAnchor(null);
    onExport(format);
  };

  return (
    <div className="je-floating-toolbar je-graph-toolbar" role="toolbar" aria-label="Graph controls">
      <ToolButton label="Zoom out" shortcut="−" icon={<ZoomOutRoundedIcon fontSize="small" />} onClick={onZoomOut} />
      <ToolButton label="Zoom in" shortcut="+" icon={<ZoomInRoundedIcon fontSize="small" />} onClick={onZoomIn} />
      <ToolButton label="Fit to screen" shortcut="F" icon={<FitScreenRoundedIcon fontSize="small" />} onClick={onFit} />
      <span className="je-toolbar-divider" />
      <ToolButton
        label={direction === 'LR' ? 'Layout: left to right (switch to top-down)' : 'Layout: top-down (switch to left to right)'}
        icon={direction === 'LR' ? <EastRoundedIcon fontSize="small" /> : <SouthRoundedIcon fontSize="small" />}
        onClick={onToggleDirection}
      />
      <ToolButton label="Expand all" icon={<UnfoldMoreRoundedIcon fontSize="small" />} onClick={onExpandAll} />
      <ToolButton label="Collapse all" icon={<UnfoldLessRoundedIcon fontSize="small" />} onClick={onCollapseAll} />
      {!compact && (
        <>
          <span className="je-toolbar-divider" />
          <ToolButton label={showMinimap ? 'Hide minimap' : 'Show minimap'} icon={<MapRoundedIcon fontSize="small" />} active={showMinimap} onClick={onToggleMinimap} />
          {onToggleFollowCursor && (
            <ToolButton
              label={followCursor ? 'Following the editor cursor (click to stop)' : 'Follow the editor cursor'}
              icon={<MyLocationRoundedIcon fontSize="small" />}
              active={followCursor}
              onClick={onToggleFollowCursor}
            />
          )}
          <ToolButton label="Export image" icon={<ImageRoundedIcon fontSize="small" />} onClick={(event) => setExportAnchor(event.currentTarget)} aria-haspopup="menu" />
        </>
      )}
      <Menu anchorEl={exportAnchor} open={Boolean(exportAnchor)} onClose={() => setExportAnchor(null)}>
        <MenuItem onClick={() => runExport('png')}>
          <ListItemIcon>
            <ImageRoundedIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText primary="Download PNG" />
        </MenuItem>
        <MenuItem onClick={() => runExport('svg')}>
          <ListItemIcon>
            <ImageRoundedIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText primary="Download SVG" />
        </MenuItem>
        <MenuItem onClick={() => runExport('clipboard')}>
          <ListItemIcon>
            <ContentCopyRoundedIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText primary="Copy image to clipboard" />
        </MenuItem>
      </Menu>
    </div>
  );
}
