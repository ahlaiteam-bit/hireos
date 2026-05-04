import React from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Dashboard from './pages/Dashboard';
import TestPage from './pages/TestPage';

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/test/:id" element={<TestPage />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
