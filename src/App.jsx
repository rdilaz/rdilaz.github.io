import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Home from './pages/Home';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* If the URL is exactly "/", load the Home component */}
        <Route path="/" element={<Home />} />
      </Routes>
    </BrowserRouter>
  );
}
