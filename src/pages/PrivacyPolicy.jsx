import { Link } from 'react-router-dom';

export default function PrivacyPolicy() {
  return (
    <div style={{ padding: '2rem', maxWidth: '800px', margin: '0 auto', fontFamily: 'sans-serif' }}>
      <Link to="/" style={{ color: '#646cff', textDecoration: 'none' }}>
        &larr; Back to Portfolio
      </Link>
      
      <h1 style={{ marginTop: '2rem' }}>Privacy Policy for Spam Shredder</h1>
      <p style={{ color: '#666' }}>Last updated: June 27, 2026</p>
      
      <section style={{ marginTop: '2rem' }}>
        <h2>1. Information We Collect</h2>
        <p>
          Spam Shredder is designed to operate locally on your device. We do not collect, 
          transmit, or store any personal data, email content, or browsing history on external servers.
        </p>
        
        {/* Add the rest of your Chrome Web Store required policy text here */}
        <h2>2. How We Use Information</h2>
        <p>All processing is done client-side...</p>
      </section>
    </div>
  );
}