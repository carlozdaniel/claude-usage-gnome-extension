/* Claude Usage — GNOME Shell top-bar indicator for Claude Pro/Max usage limits. */
'use strict';

const { St, Gio, GLib, GObject, Soup, Clutter } = imports.gi;
const Main = imports.ui.main;
const PanelMenu = imports.ui.panelMenu;
const PopupMenu = imports.ui.popupMenu;
const Util = imports.misc.util;
const ByteArray = imports.byteArray;
const ExtensionUtils = imports.misc.extensionUtils;

const Me = ExtensionUtils.getCurrentExtension();

const USAGE_URL = 'https://api.anthropic.com/api/oauth/usage';
const OAUTH_BETA_HEADER = 'oauth-2025-04-20';
const DEFAULT_ICON_PATH = Me.dir.get_child('icons').get_child('claude-usage-symbolic.svg').get_path();

function humanizeKind(limit) {
    if (limit.kind === 'session')
        return 'Current session';
    if (limit.kind === 'weekly_all')
        return 'Weekly · All models';
    if (limit.kind === 'weekly_scoped' && limit.scope && limit.scope.model && limit.scope.model.display_name)
        return `Weekly · ${limit.scope.model.display_name}`;
    return String(limit.kind || 'Limit')
        .replace(/_/g, ' ')
        .replace(/\b\w/g, c => c.toUpperCase());
}

function formatResetIn(isoString) {
    if (!isoString)
        return '';
    const resetMs = Date.parse(isoString);
    if (isNaN(resetMs))
        return '';
    const diffMs = resetMs - Date.now();
    if (diffMs <= 0)
        return 'Resetting…';
    const totalMinutes = Math.round(diffMs / 60000);
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    if (hours <= 0)
        return `Reset in ${minutes}m`;
    if (minutes === 0)
        return `Reset in ${hours}h`;
    return `Reset in ${hours}h ${minutes}m`;
}

function severityStyleClass(percent) {
    if (percent >= 90)
        return 'claude-usage-critical';
    if (percent >= 75)
        return 'claude-usage-warning';
    return 'claude-usage-normal';
}

function formatClock(date) {
    return '%02d:%02d'.format(date.getHours(), date.getMinutes());
}

const UsageMenuItem = GObject.registerClass(
class UsageMenuItem extends PopupMenu.PopupBaseMenuItem {
    _init(limit) {
        super._init({ reactive: false, can_focus: false });

        const textBox = new St.BoxLayout({ vertical: true, x_expand: true });
        const title = new St.Label({
            text: humanizeKind(limit),
            style_class: 'claude-usage-item-title',
        });
        const subtitle = new St.Label({
            text: formatResetIn(limit.resets_at),
            style_class: 'claude-usage-item-subtitle',
        });
        textBox.add_child(title);
        textBox.add_child(subtitle);

        const percentLabel = new St.Label({
            text: `${limit.percent}%`,
            style_class: `claude-usage-item-percent ${severityStyleClass(limit.percent)}`,
            y_align: Clutter.ActorAlign.CENTER,
        });

        this.add_child(textBox);
        this.add_child(percentLabel);
    }
});

const Indicator = GObject.registerClass(
class Indicator extends PanelMenu.Button {
    _init() {
        super._init(0.5, 'Claude Usage', false);

        this._settings = ExtensionUtils.getSettings();
        this._httpSession = new Soup.Session();
        this._timeoutId = null;
        this._lastUsage = null;
        this._lastError = null;
        this._lastUpdated = null;

        const box = new St.BoxLayout({ style_class: 'claude-usage-panel-box' });
        this._icon = new St.Icon({ style_class: 'system-status-icon claude-usage-panel-icon' });
        this._percentLabel = new St.Label({
            text: '…',
            style_class: 'claude-usage-panel-label',
            y_align: Clutter.ActorAlign.CENTER,
        });
        box.add_child(this._icon);
        box.add_child(this._percentLabel);
        this.add_child(box);

        this._updateIcon();
        this._rebuildMenu(null, null);

        this._settingsSignals = [
            this._settings.connect('changed::icon-path', () => this._updateIcon()),
            this._settings.connect('changed::refresh-interval', () => this._startRefreshLoop()),
            this._settings.connect('changed::show-percentage', () => this._applyUsageToPanel()),
            this._settings.connect('changed::credentials-path', () => this._refresh()),
        ];

        this.connect('destroy', () => this._onDestroy());

        this._startRefreshLoop();
    }

    _updateIcon() {
        const custom = this._settings.get_string('icon-path');
        const path = custom && GLib.file_test(custom, GLib.FileTest.EXISTS)
            ? custom : DEFAULT_ICON_PATH;
        this._icon.gicon = Gio.icon_new_for_string(path);
    }

    _startRefreshLoop() {
        this._stopRefreshLoop();
        const interval = this._settings.get_int('refresh-interval');
        this._refresh();
        this._timeoutId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, interval, () => {
            this._refresh();
            return GLib.SOURCE_CONTINUE;
        });
    }

    _stopRefreshLoop() {
        if (this._timeoutId) {
            GLib.Source.remove(this._timeoutId);
            this._timeoutId = null;
        }
    }

    _credentialsPath() {
        const override = this._settings.get_string('credentials-path');
        if (override)
            return override;
        return GLib.build_filenamev([GLib.get_home_dir(), '.claude', '.credentials.json']);
    }

    _refresh() {
        const credPath = this._credentialsPath();
        const file = Gio.File.new_for_path(credPath);
        if (!file.query_exists(null)) {
            this._setError('Claude Code credentials not found');
            return;
        }

        let text;
        try {
            const [, bytes] = file.load_contents(null);
            text = ByteArray.toString(bytes);
        } catch (e) {
            this._setError('Could not read credentials file');
            return;
        }

        let creds;
        try {
            creds = JSON.parse(text);
        } catch (e) {
            this._setError('Credentials file is not valid JSON');
            return;
        }

        const oauth = creds.claudeAiOauth;
        if (!oauth || !oauth.accessToken) {
            this._setError('No Claude Code session found — run "claude" to log in');
            return;
        }

        if (oauth.expiresAt && Date.now() > oauth.expiresAt) {
            this._setError('Claude Code session expired — run "claude" to refresh');
            return;
        }

        const message = Soup.Message.new('GET', USAGE_URL);
        message.request_headers.append('Authorization', `Bearer ${oauth.accessToken}`);
        message.request_headers.append('anthropic-beta', OAUTH_BETA_HEADER);
        message.request_headers.append('Content-Type', 'application/json');

        this._httpSession.queue_message(message, (session, msg) => {
            if (msg.status_code === 401) {
                this._setError('Claude Code session expired — run "claude" to refresh');
                return;
            }
            if (msg.status_code === 429) {
                this._setError('Rate limited by Anthropic — retrying later');
                return;
            }
            if (msg.status_code !== 200) {
                this._setError(`Network error (${msg.status_code})`);
                return;
            }
            let usage;
            try {
                usage = JSON.parse(msg.response_body.data);
            } catch (e) {
                this._setError('Unexpected response from Anthropic');
                return;
            }
            this._onUsage(usage);
        });
    }

    _onUsage(usage) {
        this._lastError = null;
        this._lastUsage = usage;
        this._lastUpdated = formatClock(new Date());
        this._applyUsageToPanel();
        this._rebuildMenu(usage, null);
    }

    _setError(msg) {
        this._lastError = msg;
        this._percentLabel.text = '!';
        this._percentLabel.style_class = 'claude-usage-panel-label claude-usage-critical';
        this._rebuildMenu(null, msg);
    }

    _applyUsageToPanel() {
        if (!this._lastUsage)
            return;
        const sessionLimit = (this._lastUsage.limits || []).find(l => l.kind === 'session');
        const percent = sessionLimit ? sessionLimit.percent : null;

        if (this._settings.get_boolean('show-percentage') && percent !== null) {
            this._percentLabel.text = `${percent}%`;
            this._percentLabel.style_class = `claude-usage-panel-label ${severityStyleClass(percent)}`;
            this._percentLabel.show();
        } else {
            this._percentLabel.hide();
        }
    }

    _rebuildMenu(usage, errorMsg) {
        this.menu.removeAll();

        if (errorMsg) {
            this.menu.addMenuItem(new PopupMenu.PopupMenuItem(errorMsg, { reactive: false }));
        } else if (usage && usage.limits && usage.limits.length > 0) {
            usage.limits.forEach(limit => this.menu.addMenuItem(new UsageMenuItem(limit)));
        } else {
            this.menu.addMenuItem(new PopupMenu.PopupMenuItem('Loading…', { reactive: false }));
        }

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        const footer = new PopupMenu.PopupBaseMenuItem({ reactive: false, can_focus: false });
        const updatedLabel = new St.Label({
            text: this._lastUpdated ? `Updated ${this._lastUpdated}` : '',
            style_class: 'claude-usage-footer-label',
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        footer.add_child(updatedLabel);

        const refreshBtn = new St.Button({
            style_class: 'claude-usage-footer-button',
            child: new St.Icon({ icon_name: 'view-refresh-symbolic', style_class: 'popup-menu-icon' }),
        });
        refreshBtn.connect('clicked', () => this._refresh());
        footer.add_child(refreshBtn);

        const settingsBtn = new St.Button({
            style_class: 'claude-usage-footer-button',
            child: new St.Icon({ icon_name: 'emblem-system-symbolic', style_class: 'popup-menu-icon' }),
        });
        settingsBtn.connect('clicked', () => {
            this.menu.close();
            Util.trySpawnCommandLine(`gnome-extensions prefs ${Me.metadata.uuid}`);
        });
        footer.add_child(settingsBtn);

        this.menu.addMenuItem(footer);
    }

    _onDestroy() {
        this._stopRefreshLoop();
        if (this._httpSession) {
            this._httpSession.abort();
            this._httpSession = null;
        }
        if (this._settingsSignals) {
            this._settingsSignals.forEach(id => this._settings.disconnect(id));
            this._settingsSignals = null;
        }
    }
});

let _indicator = null;

function init() {
}

function enable() {
    _indicator = new Indicator();
    Main.panel.addToStatusArea(Me.metadata.uuid, _indicator);
}

function disable() {
    if (_indicator) {
        _indicator.destroy();
        _indicator = null;
    }
}
