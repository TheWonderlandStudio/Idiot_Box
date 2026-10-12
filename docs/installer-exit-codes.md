# Idiot Box Windows installer — exit codes & silent flags

The Windows `.exe` installer is built with [NSIS](https://nsis.sourceforge.io/)
via electron-builder and uses the standard NSIS exit-code scheme
([NSIS Users Manual, Appendix D — Error Levels](https://nsis.sourceforge.io/Docs/AppendixD.html)).
No custom/miscellaneous return codes are defined.

## Exit codes

| Code | Meaning |
| ---- | ------- |
| `0` | Success — installation completed. |
| `1` | Installation aborted by the user (cancel button). |
| `2` | Installation aborted by the script (an error occurred, e.g. disk write failure). |

Scenarios with no distinct code: reinstalling over an existing install
simply upgrades it (exit `0`); the offline installer performs no downloads
(no network-failure code) and never requests a reboot. Concurrent installs
are not blocked with a dedicated code — a failed run exits `2`.

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
