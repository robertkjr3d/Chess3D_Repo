This directory stores timestamped backups created by `scripts/backup.js`.

Usage:
- Run `npm run vibebackup <path/to/file>` from the `frontend` folder to create a backup.
- Backups are stored under `.vibebackups/<original_path>/<filename>.<timestamp>.bak`.
- An `index.json` maps original files to their backups.

Keep this folder out of version control if desired.
