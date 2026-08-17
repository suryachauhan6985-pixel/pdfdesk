// Homepage — render tool cards

const TOOLS = [
  { id: "merge", name: "Merge PDF", desc: "Combine multiple PDFs into one file", icon: "🧩", href: "merge.html", active: true },
  { id: "split", name: "Split PDF", desc: "Extract pages or split into multiple files", icon: "✂️", href: "split.html", active: true },
  { id: "compress", name: "Compress PDF", desc: "Reduce file size while keeping quality", icon: "🗜️", href: "compress.html", active: true },
  { id: "rotate", name: "Rotate PDF", desc: "Rotate pages left or right", icon: "🔄", href: "rotate.html", active: true },
  { id: "edit", name: "Edit PDF", desc: "Add text, images, shapes and drawings", icon: "📝", href: "edit.html", active: true },
  { id: "pdf-to-jpg", name: "PDF to JPG", desc: "Convert PDF pages to images", icon: "🖼️", href: "#", active: false },
  { id: "jpg-to-pdf", name: "JPG to PDF", desc: "Convert images into a PDF", icon: "📄", href: "#", active: false },
  { id: "watermark", name: "Add Watermark", desc: "Add text or image watermark", icon: "💧", href: "#", active: false },
  { id: "page-numbers", name: "Page Numbers", desc: "Add page numbers to your PDF", icon: "🔢", href: "#", active: false },
  { id: "protect", name: "Protect PDF", desc: "Add password protection", icon: "🔒", href: "#", active: false },
  { id: "unlock", name: "Unlock PDF", desc: "Remove password from PDF", icon: "🔓", href: "#", active: false }
];

const grid = document.getElementById("toolsGrid");

TOOLS.forEach((tool) => {
  const card = document.createElement(tool.active ? "a" : "div");
  card.className = "tool-card" + (tool.active ? "" : " disabled");
  if (tool.active) card.href = tool.href;

  card.innerHTML = `
    <div class="tool-icon">${tool.icon}</div>
    <div class="tool-name">${tool.name}</div>
    <div class="tool-desc">${tool.desc}</div>
    ${!tool.active ? '<div class="tool-tag">Coming soon</div>' : ""}
  `;

  grid.appendChild(card);
});