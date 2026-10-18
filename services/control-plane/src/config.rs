//! Canonical host settings. Only references, never resolved secrets, are serializable.
use std::{collections::BTreeSet, fmt, ops::Deref};

use serde::{Deserialize, Serialize};
use shared_contracts::CredentialReference;

#[derive(Debug)]
pub struct BootstrapConfig {
    pub config: ValidatedConfig,
    secrets: std::collections::BTreeMap<String, SecretValue>,
}

pub struct SecretValue(String);

impl fmt::Debug for SecretValue {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("[REDACTED]")
    }
}

impl SecretValue {
    /// Explicit server-side access; never serialize or log the returned value.
    pub fn expose(&self) -> &str {
        &self.0
    }
}

impl BootstrapConfig {
    /// Blocking host I/O; call before starting Tokio or from a blocking task.
    #[cfg(unix)]
    pub fn load(root: &std::path::Path) -> Result<Self, ConfigError> {
        use rustix::fs::{Mode, OFlags, open, openat};
        let root = open(
            root,
            OFlags::RDONLY | OFlags::DIRECTORY | OFlags::CLOEXEC,
            Mode::empty(),
        )
        .map_err(|_| {
            ConfigError::new("storageRoot", "provide a readable host storage directory")
        })?;
        let platform = openat(&root, "_platform", OFlags::RDONLY | OFlags::DIRECTORY | OFlags::CLOEXEC | OFlags::NOFOLLOW, Mode::empty())
            .map_err(|_| ConfigError::new("_platform", "provide a readable real directory beneath the storage root; symlinks are forbidden"))?;
        let config =
            HostConfig::parse(&read_host_file(&platform, "config.yaml", false)?)?.validate()?;
        let values: std::collections::BTreeMap<String, String> = parse_yaml(
            &read_host_file(&platform, "secrets.yaml", true)?,
            "secrets.yaml",
        )?;
        let mut secrets = std::collections::BTreeMap::new();
        for (name, value) in values {
            if !credential_name(&name) || value.trim().is_empty() {
                return Err(ConfigError::new(
                    "secrets.yaml",
                    "use valid credential names and non-empty string values",
                ));
            }
            secrets.insert(name, SecretValue(value));
        }
        let loaded = Self { config, secrets };
        let github = &loaded.config.auth.github;
        loaded.require_secret(
            &loaded.config.tls.digital_ocean_token_ref,
            "tls.digitalOceanTokenRef",
        )?;
        loaded.require_secret(&github.client_secret_ref, "auth.github.clientSecretRef")?;
        for (index, owner) in loaded.config.gitops.discovery.owners.iter().enumerate() {
            loaded.require_secret(
                &owner.credential_ref,
                &format!("gitops.discovery.owners[{index}].credentialRef"),
            )?;
        }
        Ok(loaded)
    }

    #[cfg(not(unix))]
    pub fn load(_root: &std::path::Path) -> Result<Self, ConfigError> {
        Err(ConfigError::new(
            "storageRoot",
            "host configuration requires Unix file permissions",
        ))
    }

    fn require_secret(
        &self,
        reference: &CredentialReference,
        path: &str,
    ) -> Result<(), ConfigError> {
        self.secret(reference).map(|_| ()).map_err(|_| {
            ConfigError::new(path, "add the named credential to _platform/secrets.yaml")
        })
    }

    pub fn secret(&self, reference: &CredentialReference) -> Result<&SecretValue, ConfigError> {
        self.secrets
            .get(reference.as_ref())
            .ok_or_else(|| ConfigError::new("secrets.yaml", "referenced credential is missing"))
    }
}

#[cfg(unix)]
fn read_host_file(
    directory: &std::os::fd::OwnedFd,
    path: &str,
    secret: bool,
) -> Result<String, ConfigError> {
    use rustix::fs::{Mode, OFlags, openat};
    use std::{io::Read, os::unix::fs::PermissionsExt};
    let fd = openat(
        directory,
        path,
        OFlags::RDONLY | OFlags::CLOEXEC | OFlags::NOFOLLOW | OFlags::NONBLOCK,
        Mode::empty(),
    )
    .map_err(|_| {
        ConfigError::new(
            path,
            "provide a readable regular host file; symlinks are forbidden",
        )
    })?;
    let file = std::fs::File::from(fd);
    let metadata = file
        .metadata()
        .map_err(|_| ConfigError::new(path, "cannot inspect host file"))?;
    if !metadata.is_file() {
        return Err(ConfigError::new(path, "provide a regular host file"));
    }
    if secret
        && metadata.permissions().mode() & 0o777 != 0o600
        && metadata.permissions().mode() & 0o777 != 0o400
    {
        return Err(ConfigError::new(
            path,
            "restrict secret file permissions to 0600 (or read-only 0400)",
        ));
    }
    let mut bytes = Vec::new();
    file.take((MAX_FILE_BYTES + 1) as u64)
        .read_to_end(&mut bytes)
        .map_err(|_| ConfigError::new(path, "cannot read host file"))?;
    if bytes.len() > MAX_FILE_BYTES {
        return Err(ConfigError::new(path, "file exceeds the 1 MiB limit"));
    }
    String::from_utf8(bytes).map_err(|_| ConfigError::new(path, "use UTF-8 YAML"))
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct HostConfig {
    pub cluster_domain: String,
    pub tls: TlsConfig,
    pub auth: AuthConfig,
    pub gitops: GitopsConfig,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TlsConfig {
    pub digital_ocean_token_ref: CredentialReference,
    pub acme: AcmeConfig,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AcmeConfig {
    pub environment: AcmeEnvironment,
    pub email: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AcmeEnvironment {
    Staging,
    Production,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AuthConfig {
    pub github: GithubConfig,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GithubConfig {
    pub client_id: String,
    pub client_secret_ref: CredentialReference,
    pub callback_url: String,
    pub allowed_usernames: Vec<String>,
    pub admin_usernames: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct GitopsConfig {
    pub discovery: DiscoveryConfig,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DiscoveryConfig {
    pub owners: Vec<DiscoveryOwner>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DiscoveryOwner {
    #[serde(rename = "type")]
    pub kind: OwnerType,
    pub name: String,
    pub credential_ref: CredentialReference,
}

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum OwnerType {
    User,
    Org,
}

/// Contains only controlled field paths and remediation, never parser input/errors.
#[derive(Debug)]
pub struct ConfigError {
    pub path: String,
    pub problem: &'static str,
}

impl ConfigError {
    fn new(path: impl Into<String>, problem: &'static str) -> Self {
        Self {
            path: path.into(),
            problem,
        }
    }
}

impl fmt::Display for ConfigError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}: {}", self.path, self.problem)
    }
}
impl std::error::Error for ConfigError {}

#[derive(Debug)]
pub struct ValidatedConfig(HostConfig);

impl Deref for ValidatedConfig {
    type Target = HostConfig;
    fn deref(&self) -> &Self::Target {
        &self.0
    }
}

impl HostConfig {
    pub fn parse(yaml: &str) -> Result<Self, ConfigError> {
        parse_yaml(yaml, "config.yaml")
    }

    pub fn validate(mut self) -> Result<ValidatedConfig, ConfigError> {
        self.cluster_domain.make_ascii_lowercase();
        if !valid_domain(&self.cluster_domain) {
            return Err(ConfigError::new(
                "clusterDomain",
                "use a DNS domain with at least two labels (maximum 248 bytes)",
            ));
        }
        reference(
            &self.tls.digital_ocean_token_ref,
            "tls.digitalOceanTokenRef",
        )?;
        let email = &self.tls.acme.email;
        if !email.split_once('@').is_some_and(|(local, domain)| {
            !local.is_empty() && !domain.contains('@') && valid_domain(domain)
        }) || email.chars().any(char::is_whitespace)
        {
            return Err(ConfigError::new(
                "tls.acme.email",
                "provide an ACME contact email",
            ));
        }
        let github = &mut self.auth.github;
        if github.client_id.trim().is_empty() || github.client_id.chars().any(char::is_whitespace) {
            return Err(ConfigError::new(
                "auth.github.clientId",
                "provide the GitHub OAuth client ID",
            ));
        }
        reference(&github.client_secret_ref, "auth.github.clientSecretRef")?;
        let callback_ok = url::Url::parse(&github.callback_url).is_ok_and(|url| {
            url.scheme() == "https"
                && url.host_str() == Some(format!("paas.{}", self.cluster_domain).as_str())
                && url.port().is_none()
                && url.username().is_empty()
                && url.password().is_none()
                && url.query().is_none()
                && url.fragment().is_none()
                && url.path().starts_with("/api/")
                && url.path().len() > 5
        });
        if !callback_ok || github.callback_url.chars().any(char::is_whitespace) {
            return Err(ConfigError::new(
                "auth.github.callbackUrl",
                "register an HTTPS callback under /api/ on paas.<clusterDomain>, without credentials, query, fragment, or alternate port",
            ));
        }
        usernames(
            &mut github.allowed_usernames,
            "auth.github.allowedUsernames",
        )?;
        usernames(&mut github.admin_usernames, "auth.github.adminUsernames")?;
        if self.gitops.discovery.owners.is_empty() {
            return Err(ConfigError::new(
                "gitops.discovery.owners",
                "configure at least one discovery owner",
            ));
        }
        let mut seen = BTreeSet::new();
        for (index, owner) in self.gitops.discovery.owners.iter_mut().enumerate() {
            let path = format!("gitops.discovery.owners[{index}]");
            owner.name.make_ascii_lowercase();
            if !github_name(&owner.name) {
                return Err(ConfigError::new(
                    format!("{path}.name"),
                    "use a GitHub username/owner: 1-39 ASCII letters/digits with single internal hyphens",
                ));
            }
            if !seen.insert(owner.name.clone()) {
                return Err(ConfigError::new(
                    path,
                    "remove duplicate discovery owners (case-insensitive)",
                ));
            }
            reference(&owner.credential_ref, &format!("{path}.credentialRef"))?;
        }
        Ok(ValidatedConfig(self))
    }
}

const MAX_FILE_BYTES: usize = 1024 * 1024;

fn parse_yaml<T: serde::de::DeserializeOwned>(yaml: &str, path: &str) -> Result<T, ConfigError> {
    if yaml.len() > MAX_FILE_BYTES {
        return Err(ConfigError::new(path, "file exceeds the 1 MiB limit"));
    }
    let options =
        serde_saphyr::options! { duplicate_keys: serde_saphyr::DuplicateKeyPolicy::Error };
    serde_saphyr::from_str_with_options(yaml, options)
        .map_err(|error| {
            let path = match error.location() {
                Some(location) => format!("{path}:{}:{}", location.line(), location.column()),
                None => path.to_owned(),
            };
            ConfigError::new(path, "invalid YAML/schema; check required fields, types, unknown fields, and duplicate keys against the configuration guide")
        })
}

fn valid_domain(domain: &str) -> bool {
    domain.len() <= 248
        && domain.contains('.')
        && domain.split('.').all(|label| {
            !label.is_empty()
                && label.len() <= 63
                && label.starts_with(|c: char| c.is_ascii_alphanumeric())
                && label.ends_with(|c: char| c.is_ascii_alphanumeric())
                && label
                    .bytes()
                    .all(|c| c.is_ascii_alphanumeric() || c == b'-')
        })
        && domain.parse::<std::net::IpAddr>().is_err()
}

fn github_name(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 39
        && !name.contains("--")
        && name.starts_with(|c: char| c.is_ascii_alphanumeric())
        && name.ends_with(|c: char| c.is_ascii_alphanumeric())
        && name.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'-')
}

fn credential_name(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 128
        && name.starts_with(|c: char| c.is_ascii_alphanumeric())
        && name
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || c == b'-' || c == b'_')
}

fn reference(value: &CredentialReference, path: &str) -> Result<(), ConfigError> {
    if !credential_name(value.as_ref()) {
        return Err(ConfigError::new(
            path,
            "use a credential name: 1-128 ASCII letters/digits, hyphens or underscores, starting with a letter/digit",
        ));
    }
    Ok(())
}

fn usernames(names: &mut Vec<String>, path: &str) -> Result<(), ConfigError> {
    if names.is_empty() {
        return Err(ConfigError::new(
            path,
            "configure at least one explicit username",
        ));
    }
    for name in names.iter_mut() {
        name.make_ascii_lowercase();
        if !github_name(name) {
            return Err(ConfigError::new(
                path,
                "use GitHub usernames: 1-39 ASCII letters/digits with single internal hyphens",
            ));
        }
    }
    names.sort();
    names.dedup();
    Ok(())
}

#[cfg(test)]
mod tests;
