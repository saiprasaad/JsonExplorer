import Alert from '@mui/material/Alert';
import Snackbar from '@mui/material/Snackbar';
import { createContext, useCallback, useContext, useMemo, useState } from 'react';

const NotifierContext = createContext(() => {});

export function useNotify() {
  return useContext(NotifierContext);
}

export function NotifierProvider({ children }) {
  const [toast, setToast] = useState(null);

  const notify = useCallback((message, severity = 'success') => {
    setToast({ message, severity, key: Date.now() + Math.random() });
  }, []);

  const handleClose = useCallback((_, reason) => {
    if (reason !== 'clickaway') setToast(null);
  }, []);

  const value = useMemo(() => notify, [notify]);

  return (
    <NotifierContext.Provider value={value}>
      {children}
      <Snackbar
        key={toast?.key}
        open={Boolean(toast)}
        autoHideDuration={toast?.severity === 'error' ? 6000 : 3000}
        onClose={handleClose}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        {toast ? (
          <Alert onClose={handleClose} severity={toast.severity} variant="filled" className="je-toast">
            {toast.message}
          </Alert>
        ) : undefined}
      </Snackbar>
    </NotifierContext.Provider>
  );
}
