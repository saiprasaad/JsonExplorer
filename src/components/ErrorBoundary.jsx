import React from 'react';
import { Box, Typography, Button } from '@mui/material';

export class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('ErrorBoundary caught:', error, errorInfo);
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      return (
        <Box
          sx={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            height: '100%',
            minHeight: 200,
            background: '#1e1e1e',
            color: '#fff',
            fontFamily: 'monospace',
            padding: 4,
            textAlign: 'center',
          }}
        >
          <Typography variant="h6" sx={{ mb: 1, color: '#ff5c8d' }}>
            Something went wrong
          </Typography>
          <Typography variant="body2" sx={{ mb: 2, color: '#aaa', maxWidth: 400 }}>
            {this.state.error?.message || 'An unexpected error occurred while rendering.'}
          </Typography>
          <Button
            variant="outlined"
            onClick={this.handleReset}
            sx={{
              color: '#58A6FF',
              borderColor: '#58A6FF',
              fontFamily: 'monospace',
              '&:hover': { background: 'rgba(88,166,255,0.1)' },
            }}
          >
            Try Again
          </Button>
        </Box>
      );
    }

    return this.props.children;
  }
}
