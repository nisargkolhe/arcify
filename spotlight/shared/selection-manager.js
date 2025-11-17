// selection-manager.js - Shared selection management for spotlight components
// Consolidates identical SelectionManager implementations from overlay.js and popup.js

export class SelectionManager {
    constructor(container) {
        this.container = container;
        this.selectedIndex = 0;
        this.results = [];
    }

    updateResults(newResults) {
        this.results = newResults;
        this.selectedIndex = 0;
        this.updateVisualSelection();
    }

    moveSelection(direction) {
        const maxIndex = this.results.length - 1;
        
        if (direction === 'down') {
            this.selectedIndex = Math.min(this.selectedIndex + 1, maxIndex);
        } else if (direction === 'up') {
            this.selectedIndex = Math.max(this.selectedIndex - 1, 0);
        }
        
        this.updateVisualSelection();
    }

    moveToFirst() {
        this.selectedIndex = 0;
        this.updateVisualSelection();
    }

    moveToLast() {
        this.selectedIndex = Math.max(0, this.results.length - 1);
        this.updateVisualSelection();
    }

    getSelectedResult() {
        return this.results[this.selectedIndex] || null;
    }

    updateVisualSelection() {
        const items = this.container.querySelectorAll('.arcify-spotlight-result-item');
        items.forEach((item, index) => {
            item.classList.toggle('selected', index === this.selectedIndex);
        });
        
        // Auto-scroll selected item into view
        if (items[this.selectedIndex]) {
            items[this.selectedIndex].scrollIntoView({
                behavior: 'smooth',
                block: 'nearest'
            });
        }
    }

    // Enhanced keyboard navigation (can be extended with more features)
    handleKeyDown(event, skipContainerCheck = false) {
        if (!skipContainerCheck && !this.container.contains(document.activeElement)) {
            return false; // Not handling this event
        }

        switch (event.key) {
            case 'ArrowDown':
                event.preventDefault();
                event.stopPropagation();
                this.moveSelection('down');
                return true;

            case 'ArrowUp':
                event.preventDefault();
                event.stopPropagation();
                this.moveSelection('up');
                return true;

            case 'Home':
                event.preventDefault();
                event.stopPropagation();
                this.moveToFirst();
                return true;

            case 'End':
                event.preventDefault();
                event.stopPropagation();
                this.moveToLast();
                return true;

            default:
                return false; // Not handled
        }
    }
}