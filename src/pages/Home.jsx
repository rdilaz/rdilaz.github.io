import { Link } from 'react-router-dom';

export default function Home() {
  return (
    <div style={{ padding: '4rem 2rem', maxWidth: '800px', margin: '0 auto', fontFamily: 'sans-serif' }}>
      <h1>Ryo Nagaki-DiLazzaro</h1>
      <h2 style={{ color: '#666', fontWeight: 'normal' }}>Software Developer</h2>
      
      <div style={{ marginTop: '3rem' }}>
        <h3>Projects</h3>
        <ul style={{ lineHeight: '1.8' }}>
          <li>
            <a href="https://mcb.ryo-nd.com" target="_blank" rel="noopener noreferrer" style={{ color: '#646cff' }}>
              Most Common Blunder
            </a>
            {' '} - A chess analysis tool using Stockfish.
          </li>
          <li>
            Spam Shredder - A client-side Chrome extension. 
            (<a href="/SpamShredder/privacy.html" style={{ color: '#646cff' }}>Privacy Policy</a>)
          </li>
        </ul>
      </div>
    </div>
  );
}
