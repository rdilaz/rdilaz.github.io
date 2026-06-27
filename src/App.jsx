import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Home from './pages/Home';
import PrivacyPolicy from './pages/PrivacyPolicy';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* If the URL is exactly "/", load the Home component */}
        <Route path="/" element={<Home />} />
        
        {/* If the URL matches this path, load the PrivacyPolicy component */}
        <Route path="/spam-shredder/privacy" element={<PrivacyPolicy />} />
      </Routes>
    </BrowserRouter>
  );
}