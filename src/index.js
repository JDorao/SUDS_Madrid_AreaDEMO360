import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App'; // Importa tu componente App desde App.js
import './index.css'; // Si tienes un archivo CSS global, si no, puedes eliminar esta línea

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
