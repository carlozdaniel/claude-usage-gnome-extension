'use strict';

const { Gtk, Gio, GLib, GdkPixbuf } = imports.gi;
const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();

function init() {
}

function scaledPixbuf(path, size) {
    try {
        return GdkPixbuf.Pixbuf.new_from_file_at_scale(path, size, size, true);
    } catch (e) {
        return null;
    }
}

function scaledImage(path, size) {
    const pixbuf = scaledPixbuf(path, size);
    return pixbuf
        ? Gtk.Image.new_from_pixbuf(pixbuf)
        : new Gtk.Image({ icon_name: 'image-x-generic-symbolic', pixel_size: size });
}

function buildPrefsWidget() {
    const settings = ExtensionUtils.getSettings();

    const page = new Gtk.Grid({
        margin: 18,
        row_spacing: 14,
        column_spacing: 18,
        column_homogeneous: false,
        row_homogeneous: false,
    });

    let row = 0;

    // --- Custom panel icon ---
    const iconsDir = Me.dir.get_child('icons');
    const PRESETS = [
        { name: 'Claude (default)', path: iconsDir.get_child('claude-logo.png').get_path() },
        { name: 'Car', path: iconsDir.get_child('car-icon.png').get_path() },
        { name: 'Sparkle (original)', path: iconsDir.get_child('claude-usage-symbolic.svg').get_path() },
    ];

    const iconLabel = new Gtk.Label({ label: 'Panel icon', halign: Gtk.Align.START, valign: Gtk.Align.START });
    page.attach(iconLabel, 0, row, 1, 1);

    const iconColumn = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, spacing: 8 });

    const currentPath = settings.get_string('icon-path');
    const iconPreview = scaledImage(currentPath || PRESETS[0].path, 32);

    const presetRow = new Gtk.Box({ orientation: Gtk.Orientation.HORIZONTAL, spacing: 6 });
    const presetButtons = [];
    PRESETS.forEach(preset => {
        const btn = new Gtk.Button({ tooltip_text: preset.name, width_request: 44, height_request: 44 });
        btn.set_image(scaledImage(preset.path, 28));
        btn.set_always_show_image(true);
        btn.get_style_context().add_class('flat');
        if ((currentPath || PRESETS[0].path) === preset.path)
            btn.get_style_context().add_class('suggested-action');
        btn.connect('clicked', () => {
            settings.set_string('icon-path', preset === PRESETS[0] ? '' : preset.path);
            iconPreview.set_from_pixbuf(scaledPixbuf(preset.path, 32));
            presetButtons.forEach(b => b.button.get_style_context().remove_class('suggested-action'));
            btn.get_style_context().add_class('suggested-action');
        });
        presetButtons.push({ button: btn, preset });
        presetRow.pack_start(btn, false, false, 0);
    });

    const chooseBtn = new Gtk.Button({ label: 'Choose custom image…' });
    chooseBtn.connect('clicked', () => {
        const dialog = new Gtk.FileChooserDialog({
            title: 'Select a panel icon',
            action: Gtk.FileChooserAction.OPEN,
            transient_for: page.get_root ? page.get_root() : page.get_toplevel(),
        });
        dialog.add_button('Cancel', Gtk.ResponseType.CANCEL);
        dialog.add_button('Select', Gtk.ResponseType.ACCEPT);

        const filter = new Gtk.FileFilter();
        filter.set_name('Images');
        filter.add_mime_type('image/svg+xml');
        filter.add_mime_type('image/png');
        filter.add_mime_type('image/jpeg');
        dialog.add_filter(filter);

        dialog.connect('response', (dlg, response) => {
            if (response === Gtk.ResponseType.ACCEPT) {
                const file = dlg.get_file();
                const path = file.get_path();
                settings.set_string('icon-path', path);
                iconPreview.set_from_pixbuf(scaledPixbuf(path, 32));
                presetButtons.forEach(b => b.button.get_style_context().remove_class('suggested-action'));
            }
            dlg.destroy();
        });
        dialog.show();
    });

    const previewRow = new Gtk.Box({ orientation: Gtk.Orientation.HORIZONTAL, spacing: 8 });
    previewRow.pack_start(iconPreview, false, false, 0);
    previewRow.pack_start(chooseBtn, false, false, 0);

    iconColumn.pack_start(presetRow, false, false, 0);
    iconColumn.pack_start(previewRow, false, false, 0);

    page.attach(iconColumn, 1, row, 1, 1);
    row++;

    // --- Show percentage in panel ---
    const showPercentLabel = new Gtk.Label({ label: 'Show percentage in panel', halign: Gtk.Align.START });
    page.attach(showPercentLabel, 0, row, 1, 1);
    const showPercentSwitch = new Gtk.Switch({
        active: settings.get_boolean('show-percentage'),
        halign: Gtk.Align.START,
    });
    settings.bind('show-percentage', showPercentSwitch, 'active', Gio.SettingsBindFlags.DEFAULT);
    page.attach(showPercentSwitch, 1, row, 1, 1);
    row++;

    // --- Refresh interval ---
    const intervalLabel = new Gtk.Label({ label: 'Refresh interval (seconds)', halign: Gtk.Align.START });
    page.attach(intervalLabel, 0, row, 1, 1);
    const intervalSpin = new Gtk.SpinButton({
        adjustment: new Gtk.Adjustment({ lower: 15, upper: 3600, step_increment: 15 }),
        value: settings.get_int('refresh-interval'),
    });
    settings.bind('refresh-interval', intervalSpin, 'value', Gio.SettingsBindFlags.DEFAULT);
    page.attach(intervalSpin, 1, row, 1, 1);
    row++;

    // --- Credentials path override ---
    const credLabel = new Gtk.Label({ label: 'Credentials file override', halign: Gtk.Align.START });
    page.attach(credLabel, 0, row, 1, 1);
    const credEntry = new Gtk.Entry({
        text: settings.get_string('credentials-path'),
        placeholder_text: '~/.claude/.credentials.json (default)',
        hexpand: true,
    });
    credEntry.connect('changed', () => settings.set_string('credentials-path', credEntry.get_text()));
    page.attach(credEntry, 1, row, 1, 1);
    row++;

    const hint = new Gtk.Label({
        label: 'Reads the OAuth session that the Claude Code CLI already stores locally. ' +
            'Run "claude" once to log in if usage data is not showing.',
        halign: Gtk.Align.START,
        wrap: true,
        xalign: 0,
    });
    hint.get_style_context().add_class('dim-label');
    page.attach(hint, 0, row, 2, 1);

    page.show_all();
    return page;
}
