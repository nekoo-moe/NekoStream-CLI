const fs = require('fs');
const cheerio = require('cheerio');
const html = fs.readFileSync('temp_a47.html', 'utf-8');
const $ = cheerio.load(html);

console.log('Title:', $('h1').text().trim());
console.log('Description:', $('.text-caption, .text-body2, .description').text().substring(0, 200));

// find potential info blocks
$('.q-chip, .q-badge, .text-subtitle2').each((i, el) => {
  console.log('Chip/Badge:', $(el).text().trim());
});

// find scripts with json data
$('script[type="application/ld+json"]').each((i, el) => {
  console.log('JSON-LD:', $(el).html());
});

$('script').each((i, el) => {
  const content = $(el).html();
  if (content && content.includes('window.__')) {
    console.log('Possible state:', content.substring(0, 100));
  }
});
