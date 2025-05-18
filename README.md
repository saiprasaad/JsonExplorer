# JSON Explorer

**JSON Explorer** is a visual tool for exploring and understanding JSON data structures. It provides an interactive graph-based view of your JSON, allowing you to easily navigate, inspect, and edit complex data.

🚀 **Live Demo**:  
[https://saiprasaad.github.io/JsonExplorer/](https://saiprasaad.github.io/JsonExplorer/)

## Features

- **Visual Graph View:** See your JSON as a connected graph of nodes and edges.
- **Editable JSON:** Edit your JSON in a code editor and see changes reflected instantly.
- **Node Highlighting:** Click on any node to highlight its path and see its details.
- **Dialog Details:** Click a node to open a dialog with full details of that element.
- **Tree and Array Support:** Handles nested objects and arrays gracefully.
- **Responsive Layout:** Works well on desktop and large screens.
- **Color-coded Values:** Different data types are color-coded for clarity.

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) (v16 or later recommended)
- [npm](https://www.npmjs.com/) or [yarn](https://yarnpkg.com/)

### Installation

1. Clone the repository:
    ```bash
    git clone https://github.com/your-username/json-explorer.git
    cd json-explorer
    ```

2. Install dependencies:
    ```bash
    npm install
    # or
    yarn install
    ```

3. Start the development server:
    ```bash
    npm start
    # or
    yarn start
    ```

4. Open [http://localhost:3000](http://localhost:3000) in your browser.

## Usage

- Paste or edit your JSON in the left editor pane.
- The right pane will visualize your JSON as a graph.
- Click any node to highlight its path and open a dialog with its details.
- Use the controls to pan, zoom, and reset the view.

## Project Structure

```
src/
  components/
    JsonEditor.jsx      # JSON code editor component
    JsonViewer.jsx      # Graph visualization component
  App.js                # Main app layout
```

## Customization

- You can adjust node colors, spacing, and styles in `JsonViewer.jsx`.
- The default JSON can be changed in `App.js`.

## Dependencies

- [React](https://reactjs.org/)
- [React Flow](https://reactflow.dev/) (for graph visualization)
- [Material UI](https://mui.com/) (for UI components)

---

**Enjoy exploring your JSON visually!**