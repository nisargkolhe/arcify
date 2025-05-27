# Arcify: Arc-like Vertical Tab Spaces

[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg)](https://www.gnu.org/licenses/gpl-3.0)

A Chrome extension that replicates Arc browser's tab management system, providing a vertical sidebar for efficient tab organization and management.

![Demo](assets/extension.gif)

## Features

- Vertical tab management
- Tab grouping functionality
- Keyboard shortcuts for quick access
- Bookmark integration
- Clean, minimal interface

## Development Setup

### Prerequisites

- Node.js (v16 or higher)
- npm or yarn
- Google Chrome or Chromium-based browser
- Git (for version control)
- Basic knowledge of HTML, CSS, and JavaScript

### Quick Start

1. **Clone and Install**
   ```bash
   git clone https://github.com/nisargkolhe/arcify.git
   cd arcify
   npm install
   ```

2. **Development Build**
   ```bash
   npm run dev
   ```
   This creates a `dist-dev/` folder with source maps for debugging and watches for file changes.

3. **Production Build**
   ```bash
   npm run build
   ```
   This creates an optimized `dist/` folder ready for distribution.

4. **Create Distribution Package**
   ```bash
   npm run build:zip
   ```
   This builds the extension and creates `arcify-extension.zip` for Chrome Web Store submission.

### Loading the Extension in Chrome

1. **Open Chrome Extensions page**
   - Navigate to `chrome://extensions/`
   - Or go to Menu → More Tools → Extensions

2. **Enable Developer Mode**
   - Toggle the "Developer mode" switch in the top right corner

3. **Load the Extension**
   - Click "Load unpacked"
   - Select the `dist/` or `dist-dev/` directory
   - The extension should now appear in your browser

### Development Workflow

1. **Make Changes**
   - Edit source files in the root directory
   - For development: `npm run dev` (watches for changes)
   - For production testing: `npm run build`

2. **Reload Extension**
   - Go to `chrome://extensions/`
   - Click the refresh icon on the Arcify extension card
   - Or use Ctrl+R in the extension's popup/sidebar

3. **Debug**
   - Use Chrome DevTools for the extension pages
   - Check the extension's service worker in `chrome://extensions/`
   - View console logs in the extension's background page

### Build Scripts

- `npm run dev` - Development build with file watching
- `npm run build` - Production build
- `npm run build:zip` - Build and create zip package
- `npm run zip` - Create zip from existing build
- `npm run clean` - Remove all build artifacts
- `npm run preview` - Preview the built extension
- `npm run info` - Display build information and status
- `npm run release <type>` - Create a new release (patch/minor/major/x.y.z)

### Release Process

The project uses automated releases via GitHub Actions. To create a new release:

1. **Prepare your changes**
   ```bash
   # Make sure all changes are committed
   git status
   ```

2. **Create a release**
   ```bash
   # For bug fixes (2.2.0 → 2.2.1)
   npm run release patch
   
   # For new features (2.2.0 → 2.3.0)
   npm run release minor
   
   # For breaking changes (2.2.0 → 3.0.0)
   npm run release major
   
   # For specific version
   npm run release 2.5.0
   ```

3. **Automated process**
   - Updates `package.json` and `manifest.json` versions
   - Builds and tests the extension
   - Creates a git tag and pushes to GitHub
   - GitHub Actions automatically:
     - Builds the extension
     - Generates release notes from commits
     - Creates a GitHub release
     - Attaches the zip file and SHA256 checksum

4. **Monitor the release**
   - Check the [Actions tab](https://github.com/nisargkolhe/arcify/actions) for build status
   - Review the generated release at [Releases](https://github.com/nisargkolhe/arcify/releases)

## Issues and Feature Requests

We use GitHub Issues to track bugs and feature requests. Before creating a new issue:

1. Search existing issues to avoid duplicates
2. Use our issue templates when available

### Reporting Bugs 🐛

1. Go to the [Issues](https://github.com/nisargkolhe/arcify/issues) page
2. Click "New Issue"
3. Choose "Bug Report" template if available
4. Include:
   - Clear description of the bug
   - Steps to reproduce
   - Expected vs actual behavior
   - Browser version and OS
   - Screenshots if applicable

### Feature Requests 💡

1. Go to the [Issues](https://github.com/nisargkolhe/arcify/issues) page
2. Click "New Issue"
3. Choose "Feature Request" template if available
4. Include:
   - Clear description of the feature
   - Use cases
   - Potential implementation ideas (optional)
   - Mock-ups or examples (if applicable)

## Contributing

Discord to discuss development: https://discord.gg/DFPaQJ79

We welcome contributions! Here's how you can help:

1. Fork the Repository
   - Create a fork of this repository on GitHub

2. Create a Branch
   ```bash
   git checkout -b feature/your-feature-name
   ```

3. Make Your Changes
   - Write clean, documented code
   - Follow existing code style
   - Test your changes thoroughly

4. Commit Your Changes
   ```bash
   git commit -m "Add: brief description of your changes"
   ```

5. Push to Your Fork
   ```bash
   git push origin feature/your-feature-name
   ```

6. Submit a Pull Request
   - Create a Pull Request from your fork to our main repository
   - Provide a clear description of the changes
   - Reference any related issues

### Contribution Guidelines

- Write meaningful commit messages
- Update documentation as needed
- Add comments to your code where necessary
- Test your changes before submitting
- Follow existing code style and conventions

## License

This project is licensed under the GNU General Public License v3.0 - see the [LICENSE](LICENSE) file for details.

### What this means:

- You can freely use, modify, and distribute this software
- If you modify and distribute this software, you must:
  - Make your modifications available under the GPL
  - Include the original copyright notice
  - Provide access to the source code
  - Include the full license text

## Contact

If you have any questions or suggestions, please open an issue on GitHub.

## Acknowledgments

- Inspired by the Arc Browser's innovative tab management system. Huge thanks to the Arc team for coming up with the system we've all grown to love!
- Thanks to all contributors who help improve this project 