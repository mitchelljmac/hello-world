# Brick Picker

Find the LEGO pieces you need for a set in a pile on the floor.

1. **API key** – paste a Claude API key (from console.anthropic.com). It's stored only in your browser.
2. **What are you building?** – upload a photo of the parts inventory page from the back of the instruction booklet. Claude reads it into a checklist (piece, color, count). Fix or add pieces by hand.
3. **Find them on the floor** – photograph the pile from above. Pieces you still need are circled and numbered (yellow = not sure). Tap a circle after you pick the piece up and it's checked off. Rescan as the pile changes, until you have everything.

Your checklist is saved in the browser, so you can come back later.

It's a static page (no build step): open `lego-picker/` on GitHub Pages, or run `python3 -m http.server` in the repo and visit http://localhost:8000/lego-picker/.

Note: Each scan sends the photo to the Claude API and costs a few cents. Results are best with good light and pieces spread out; small or similar pieces may be missed or mixed up.
