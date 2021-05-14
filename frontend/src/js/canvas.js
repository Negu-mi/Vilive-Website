const ctx = document.querySelector('canvas').getContext('2d');
const html = `<div class="container" id="live-session">
<img id="background" src="../image/default_bg.png" alt="image" />
<video id="gum-local" autoplay playsinline muted></video>
</div>`;
render_html_to_canvas(html, ctx, 0, 0, 300, 150);


function render_html_to_canvas(html, ctx, x, y, width, height) {
  var data = "data:image/svg+xml;charset=utf-8," + '<svg xmlns="http://www.w3.org/2000/svg" width="' + width + '" height="' + height + '">' +
    '<foreignObject width="100%" height="100%">' +
    html_to_xml(html) +
    '</foreignObject>' +
    '</svg>';

  var img = new Image();
  img.onload = function() {
    ctx.drawImage(img, x, y);
  }
  img.src = data;
}

function html_to_xml(html) {
  var doc = document.implementation.createHTMLDocument('');
  doc.write(html);

  // You must manually set the xmlns if you intend to immediately serialize     
  // the HTML document to a string as opposed to appending it to a
  // <foreignObject> in the DOM
  doc.documentElement.setAttribute('xmlns', doc.documentElement.namespaceURI);

  // Get well-formed markup
  html = (new XMLSerializer).serializeToString(doc.body);
  return html;
}