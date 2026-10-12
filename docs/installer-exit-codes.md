# Idiot Box Windows installer — exit codes & silent flags

The Windows `.exe` installer is built with [NSIS](https://nsis.sourceforge.io/)
via electron-builder and uses only the standard NSIS exit-code scheme.
No custom/m Miscellaneous return codes are defined.

## Exit codes

| Code | Meaning |
| ---- | ------- |
| `0` | Success — installation completed. |
| Non-zero | Installation did not complete (cancelled by the user or an error occurred). |

## Silent / command-line flags

| Flag | Meaning |
| ---- | ------- |
| `/S` | Silent install/uninstall (capital `S`). No UI is shown; defaults are used. |
| `/D=<path>` | Custom install directory (must be the last flag, e.g. `/S /D=C:\Apps\IdiotBox`). |
| `/NOASSOCIATIONS` | Skip registering Idiot Box as the editor for code file types. |
| `/REGISTEREDITOR=0` | Same effect as `/NOASSOCIATIONS`. |

Without flags, the installer shows a consent page
("Register Idiot Box as editor?") where the user can opt out of file
associations. Choosing opt-out restores the previous file handlers.
