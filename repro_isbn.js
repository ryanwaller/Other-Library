
async function testIsbn(isbn) {
  const url = `http://localhost:3000/api/isbn?isbn=${isbn}`;
  console.log(`Testing ISBN: ${isbn}`);
  try {
    const res = await fetch(url);
    const data = await res.json();
    console.log(JSON.stringify(data, null, 2));
  } catch (e) {
    console.error("Fetch failed:", e.message);
  }
}

const isbn = process.argv[2] || "9780743273565";
testIsbn(isbn);
