import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import 'highlight.js/styles/github-dark.css';
import './markdown.css';
import './styles.css';

createRoot(document.getElementById('root')).render(<App />);
