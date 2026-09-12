use std::{
    env,
    ffi::OsString,
    fs, io,
    path::{Path, PathBuf},
};

use shinbo_core::{JobSink, LiveClient, LiveError, start_live_runtime};

pub fn start(job_sink: JobSink) -> Result<LiveClient, LiveError> {
    let data_root = match configured_data_root()? {
        Some(path) => path,
        None => default_data_root()?,
    };
    start_live_runtime(
        data_root.join("threads"),
        data_root.join("scheduled"),
        job_sink,
    )
}

fn configured_data_root() -> Result<Option<PathBuf>, LiveError> {
    configured_data_root_from(|name| env::var_os(name))
}

fn configured_data_root_from(
    mut get: impl FnMut(&str) -> Option<OsString>,
) -> Result<Option<PathBuf>, LiveError> {
    let configured = get("SHINBO_DATA_DIR")
        .map(|value| ("SHINBO_DATA_DIR", value))
        .or_else(|| get("EMMA_DATA_DIR").map(|value| ("EMMA_DATA_DIR", value)));
    let Some((name, value)) = configured else {
        return Ok(None);
    };
    let path = PathBuf::from(value);
    if path.as_os_str().is_empty() || !path.is_absolute() {
        return Err(LiveError::new(format!(
            "{name} must be a non-empty absolute path",
        )));
    }
    Ok(Some(path))
}

fn default_data_root() -> Result<PathBuf, LiveError> {
    default_data_root_from(|name| env::var_os(name))
}

fn default_data_root_from(
    mut get: impl FnMut(&str) -> Option<std::ffi::OsString>,
) -> Result<PathBuf, LiveError> {
    #[cfg(windows)]
    let (root, user_profile_fallback) = ["APPDATA", "LOCALAPPDATA", "USERPROFILE"]
        .into_iter()
        .find_map(|name| {
            get(name)
                .filter(|value| !value.is_empty())
                .map(|value| (value, name == "USERPROFILE"))
        })
        .ok_or_else(|| {
            LiveError::new(
                "APPDATA, LOCALAPPDATA, and USERPROFILE are unset; set SHINBO_DATA_DIR to a writable folder",
            )
        })?;
    #[cfg(not(windows))]
    let root = get("HOME")
        .filter(|value| !value.is_empty())
        .ok_or_else(|| LiveError::new("HOME is unset; set SHINBO_DATA_DIR to a writable folder"))?;

    let root = PathBuf::from(root);
    #[cfg(windows)]
    {
        compatible_data_root(if user_profile_fallback {
            root.join("AppData/Roaming/Shinbo")
        } else {
            root.join("Shinbo")
        })
    }
    #[cfg(not(windows))]
    {
        compatible_data_root(root.join("Library/Application Support/Shinbo"))
    }
}

fn compatible_data_root(current: PathBuf) -> Result<PathBuf, LiveError> {
    fn populated(directory: &Path) -> io::Result<bool> {
        match fs::read_dir(directory) {
            Ok(mut entries) => entries.next().transpose().map(|entry| entry.is_some()),
            Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(false),
            Err(error) => Err(error),
        }
    }
    let previous = current.with_file_name("Emma");
    let selected = (|| -> io::Result<PathBuf> {
        Ok(if !populated(&current)? && populated(&previous)? {
            previous
        } else {
            current
        })
    })();
    selected
        .map_err(|error| LiveError::new(format!("could not select the data directory: {error}")))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(unix)]
    #[test]
    fn configured_data_root_requires_an_absolute_nonempty_unix_path() {
        let root = configured_data_root_from(|name| {
            (name == "SHINBO_DATA_DIR").then(|| "/var/lib/shinbo".into())
        })
        .unwrap()
        .unwrap();
        assert_eq!(root, PathBuf::from("/var/lib/shinbo"));

        assert!(
            configured_data_root_from(|name| {
                (name == "SHINBO_DATA_DIR").then(|| "var/lib/shinbo".into())
            })
            .is_err()
        );
        assert!(
            configured_data_root_from(|name| { (name == "SHINBO_DATA_DIR").then(|| "".into()) })
                .is_err()
        );
    }

    #[cfg(windows)]
    #[test]
    fn configured_data_root_requires_an_absolute_nonempty_windows_path() {
        let root = configured_data_root_from(|name| {
            (name == "SHINBO_DATA_DIR").then(|| r"C:\ShinboData".into())
        })
        .unwrap()
        .unwrap();
        assert_eq!(root, PathBuf::from(r"C:\ShinboData"));

        assert!(
            configured_data_root_from(|name| {
                (name == "SHINBO_DATA_DIR").then(|| r"ShinboData".into())
            })
            .is_err()
        );
        assert!(
            configured_data_root_from(|name| { (name == "SHINBO_DATA_DIR").then(|| "".into()) })
                .is_err()
        );
    }

    #[test]
    fn configured_data_root_uses_default_when_unset() {
        assert!(configured_data_root_from(|_| None).unwrap().is_none());
    }

    #[cfg(windows)]
    #[test]
    fn default_data_root_prefers_roaming_app_data_and_falls_back_to_local_data() {
        let root = default_data_root_from(|name| match name {
            "APPDATA" => Some(r"C:\Users\Shinbo\AppData\Roaming".into()),
            "LOCALAPPDATA" => Some(r"C:\Users\Shinbo\AppData\Local".into()),
            _ => None,
        })
        .unwrap();
        assert_eq!(
            root,
            PathBuf::from(r"C:\Users\Shinbo\AppData\Roaming\Shinbo")
        );

        let root = default_data_root_from(|name| match name {
            "LOCALAPPDATA" => Some(r"C:\Users\Shinbo\AppData\Local".into()),
            _ => None,
        })
        .unwrap();
        assert_eq!(root, PathBuf::from(r"C:\Users\Shinbo\AppData\Local\Shinbo"));

        let root = default_data_root_from(|name| match name {
            "USERPROFILE" => Some(r"C:\Users\Shinbo".into()),
            _ => None,
        })
        .unwrap();
        assert_eq!(
            root,
            PathBuf::from(r"C:\Users\Shinbo\AppData\Roaming\Shinbo")
        );
    }

    #[cfg(not(windows))]
    #[test]
    fn default_data_root_uses_home_on_unix() {
        let root = default_data_root_from(|name| (name == "HOME").then(|| "/Users/Shinbo".into()))
            .unwrap();
        assert_eq!(
            root,
            PathBuf::from("/Users/Shinbo/Library/Application Support/Shinbo")
        );
    }
}
