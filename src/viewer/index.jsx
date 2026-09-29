/*
 * Entry point of the offline viewer page written by the JSON Explorer CLI (explore, diff --html).
 * The page is one self-contained HTML file: the data sits in a JSON block, and the Content
 * Security Policy blocks every network request.
 */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../index.css';
import { setPersistence } from '../utils/storage';
import './viewer.css';
import { readPayload, ViewerApp } from './ViewerApp';

// Before anything renders: the page keeps no state in the browser (file:// pages share storage).
setPersistence(false);
// Match the system theme from the first paint; the app keeps it in sync afterwards.
document.documentElement.dataset.theme = window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ViewerApp payload={readPayload()} />
  </StrictMode>
);
