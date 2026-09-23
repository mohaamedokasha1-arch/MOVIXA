/* MOVIXA — Vite client entry. Catalog is rendered in the browser after build. */

const movies = [
  { title: 'Big Buck Bunny', year: 2008, rating: '8.1', type: 'Movie', href: 'https://www.youtube.com/watch?v=aqz-KE-bpKQ' },
  { title: 'Sintel', year: 2010, rating: '7.5', type: 'Movie', href: 'https://www.youtube.com/watch?v=eRsGyueVLvQ' },
  { title: 'Tears of Steel', year: 2012, rating: '7.1', type: 'Movie', href: 'https://www.youtube.com/watch?v=R6MlUcmOul8' },
  { title: 'Caminandes', year: 2013, rating: '7.4', type: 'Series', href: 'https://www.youtube.com/watch?v=Z4C82eyhwgU' }
];

function card(item) {
  return `
    <article class="card">
      <div class="card-poster">
        <div class="card-noimg">${item.title.slice(0, 2).toUpperCase()}</div>
        <div class="card-overlay">
          <span class="card-rating">★ ${item.rating}</span>
          <span class="card-year">${item.year}</span>
        </div>
      </div>
      <div class="card-body">
        <h3 class="card-title">${item.title}</h3>
        <div class="card-meta">
          <span>${item.type}</span>
          <span>${item.year}</span>
        </div>
        <a class="btn btn-primary btn-sm btn-block" href="${item.href}" target="_blank" rel="noopener noreferrer">Watch legally</a>
      </div>
    </article>
  `;
}

const movieGrid = document.getElementById('movieGrid');
const seriesGrid = document.getElementById('seriesGrid');

if (movieGrid) {
  movieGrid.innerHTML = movies.filter((item) => item.type === 'Movie').map(card).join('');
}
if (seriesGrid) {
  seriesGrid.innerHTML = movies.filter((item) => item.type === 'Series').map(card).join('');
}
