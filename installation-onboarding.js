// Installation Onboarding Flow
class InstallationOnboarding {
    constructor() {
        this.currentStep = 1;
        this.totalSteps = 5;
        this.settings = {
            archiving: false,
            spotlight: true
        };
        this.shortcuts = {
            '_execute_action': 'Alt+S',
            'quickPinToggle': 'Alt+D',
            'toggleSpotlight': 'Alt+L',
            'toggleSpotlightNewTab': 'Alt+T'
        };

        this.init();
    }

    init() {
        this.bindEvents();
        this.updateUI();
        this.loadSettings();
        this.loadKeyboardShortcuts();
    }

    bindEvents() {
        // Navigation buttons
        document.getElementById('prevBtn').addEventListener('click', () => this.previousStep());
        document.getElementById('nextBtn').addEventListener('click', () => this.nextStep());

        // Toggle buttons
        document.getElementById('archiveToggle').addEventListener('click', () => this.toggleArchiving());
        document.getElementById('spotlightToggle').addEventListener('click', () => this.toggleSpotlight());

        // Progress dots
        document.querySelectorAll('.progress-dot').forEach((dot, index) => {
            dot.addEventListener('click', () => this.goToStep(index + 1));
        });

        // Keyboard navigation
        document.addEventListener('keydown', (e) => {
            if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
                e.preventDefault();
                this.previousStep();
            } else if (e.key === 'ArrowRight' || e.key === 'ArrowDown' || e.key === 'Enter') {
                e.preventDefault();
                this.nextStep();
            } else if (e.key === 'Escape') {
                e.preventDefault();
                this.closeOnboarding();
            }
        });
    }

    nextStep() {
        if (this.currentStep === 4) {
            // Redirect to arcify.io when next is clicked on step 4 (Spotlight)
            // Pass keyboard shortcuts as URL parameters
            const urlParams = new URLSearchParams();

            // Map extension command names to URL parameter names
            if (this.shortcuts['_execute_action']) {
                urlParams.set('toggle-sidepanel', this.shortcuts['_execute_action']);
            }
            if (this.shortcuts['toggleSpotlight']) {
                urlParams.set('spotlight-search', this.shortcuts['toggleSpotlight']);
            }
            if (this.shortcuts['quickPinToggle']) {
                urlParams.set('switch-spaces', this.shortcuts['quickPinToggle']);
            }
            if (this.shortcuts['toggleSpotlightNewTab']) {
                urlParams.set('new-tab', this.shortcuts['toggleSpotlightNewTab']);
            }

            const queryString = urlParams.toString();
            const redirectUrl = queryString
                ? `https://arcify.io?${queryString}`
                : 'https://arcify.io';

            window.location.href = redirectUrl;
            return;
        }

        if (this.currentStep < this.totalSteps) {
            this.goToStep(this.currentStep + 1);
        } else {
            this.completeOnboarding();
        }
    }

    previousStep() {
        if (this.currentStep > 1) {
            this.goToStep(this.currentStep - 1);
        }
    }

    goToStep(step) {
        if (step < 1 || step > this.totalSteps) return;

        // Hide current step
        const currentStepElement = document.getElementById(`step${this.currentStep}`);
        currentStepElement.classList.remove('active');

        // Show new step
        const newStepElement = document.getElementById(`step${step}`);
        newStepElement.classList.add('active');

        // Update current step
        this.currentStep = step;

        // Update UI
        this.updateUI();
    }

    updateUI() {
        // Update step counter
        document.getElementById('currentStep').textContent = this.currentStep;

        // Update navigation buttons
        const prevBtn = document.getElementById('prevBtn');
        const nextBtn = document.getElementById('nextBtn');

        prevBtn.disabled = this.currentStep === 1;
        nextBtn.textContent = this.currentStep === this.totalSteps ? 'Get Started' : 'Next';

        // Update progress dots
        document.querySelectorAll('.progress-dot').forEach((dot, index) => {
            const stepNumber = index + 1;
            dot.classList.remove('active', 'completed');

            if (stepNumber === this.currentStep) {
                dot.classList.add('active');
            } else if (stepNumber < this.currentStep) {
                dot.classList.add('completed');
            }
        });

        // Update toggle buttons
        this.updateToggleButtons();
    }

    updateToggleButtons() {
        const archiveToggle = document.getElementById('archiveToggle');
        const spotlightToggle = document.getElementById('spotlightToggle');

        if (archiveToggle) {
            archiveToggle.textContent = this.settings.archiving ? 'Archiving is Enabled' : 'Enable Tab Archiving';
            archiveToggle.className = `toggle-button ${this.settings.archiving ? 'on' : 'off'}`;
        }

        if (spotlightToggle) {
            spotlightToggle.textContent = this.settings.spotlight ? 'Spotlight is Enabled' : 'Enable Spotlight';
            spotlightToggle.className = `toggle-button ${this.settings.spotlight ? 'on' : 'off'}`;
        }
    }

    toggleArchiving() {
        this.settings.archiving = !this.settings.archiving;
        this.updateToggleButtons();
        this.saveSettings();
    }

    toggleSpotlight() {
        this.settings.spotlight = !this.settings.spotlight;
        this.updateToggleButtons();
        this.saveSettings();
    }

    loadSettings() {
        // Load settings from chrome.storage if available
        if (chrome.storage && chrome.storage.sync) {
            chrome.storage.sync.get(['autoArchiveEnabled', 'enableSpotlight'], (result) => {
                this.settings.archiving = result.autoArchiveEnabled !== undefined ? result.autoArchiveEnabled : false;
                this.settings.spotlight = result.enableSpotlight !== undefined ? result.enableSpotlight : true;
                this.updateToggleButtons();
            });
        }
    }

    saveSettings() {
        // Save settings to chrome.storage if available
        if (chrome.storage && chrome.storage.sync) {
            chrome.storage.sync.set({
                autoArchiveEnabled: this.settings.archiving,
                enableSpotlight: this.settings.spotlight
            });
        }
    }

    async loadKeyboardShortcuts() {
        try {
            const commands = await chrome.commands.getAll();
            const shortcuts = {};

            commands.forEach(command => {
                if (command.shortcut) {
                    shortcuts[command.name] = command.shortcut;
                }
            });

            // Store shortcuts in instance for URL parameter passing
            this.shortcuts = {
                '_execute_action': shortcuts['_execute_action'] || 'Alt+S',
                'quickPinToggle': shortcuts['quickPinToggle'] || 'Alt+D',
                'toggleSpotlight': shortcuts['toggleSpotlight'] || 'Alt+L',
                'toggleSpotlightNewTab': shortcuts['toggleSpotlightNewTab'] || 'Alt+T'
            };

            // Update the shortcut display in step 5
            this.updateShortcutDisplay(shortcuts);
        } catch (error) {
            console.error('Error loading keyboard shortcuts:', error);
            // Fallback to default shortcuts
            this.shortcuts = {
                '_execute_action': 'Alt+S',
                'quickPinToggle': 'Alt+D',
                'toggleSpotlight': 'Alt+L',
                'toggleSpotlightNewTab': 'Alt+T'
            };
            this.updateShortcutDisplay(this.shortcuts);
        }
    }

    updateShortcutDisplay(shortcuts) {
        // Update shortcut keys in step 5
        const shortcutElements = {
            'toggle-sidepanel': shortcuts['_execute_action'] || 'Alt+S',
            'spotlight-search': shortcuts['toggleSpotlight'] || 'Alt+L',
            'switch-spaces': shortcuts['quickPinToggle'] || 'Alt+D', // Using quickPinToggle for space switching
            'new-tab': shortcuts['toggleSpotlightNewTab'] || 'Alt+T' // New Tab spotlight
        };

        // Update each shortcut card
        Object.keys(shortcutElements).forEach(key => {
            const element = document.querySelector(`[data-shortcut="${key}"]`);
            if (element) {
                element.textContent = shortcutElements[key];
            }
        });
    }

    completeOnboarding() {
        // Save final settings
        this.saveSettings();

        // Mark onboarding as completed
        if (chrome.storage && chrome.storage.sync) {
            chrome.storage.sync.set({ onboardingCompleted: true });
        }

        // Close the onboarding window
        this.closeOnboarding();
    }

    closeOnboarding() {
        // Close the onboarding window
        if (window.close) {
            window.close();
        } else {
            // Fallback: redirect to a blank page or show completion message
            document.body.innerHTML = `
                <div style="display: flex; align-items: center; justify-content: center; height: 100vh; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);">
                    <div style="background: white; padding: 3rem; border-radius: 16px; text-align: center; box-shadow: 0 4px 20px rgba(0, 0, 0, 0.1);">
                        <h1 style="color: #007AFF; margin-bottom: 1rem;">Setup Complete!</h1>
                        <p style="color: #666; margin-bottom: 2rem;">You can now close this window and start using Arcify.</p>
                        <button onclick="window.close()" style="background: #007AFF; color: white; border: none; padding: 1rem 2rem; border-radius: 8px; cursor: pointer;">Close Window</button>
                    </div>
                </div>
            `;
        }
    }
}

// Initialize onboarding when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    new InstallationOnboarding();
});

// Handle messages from the extension
if (chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        if (message.action === 'getSettings') {
            sendResponse({ settings: window.onboarding?.settings || {} });
        }
    });
}
