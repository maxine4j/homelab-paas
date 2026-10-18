use super::*;

const VALID: &str = "\
clusterDomain: Example.COM
tls:
  digitalOceanTokenRef: dns-token
  acme:
    environment: staging
    email: admin@example.com
auth:
  github:
    clientId: client-id
    clientSecretRef: oauth-secret
    callbackUrl: https://paas.example.com/api/auth/callback
    allowedUsernames: [App-User]
    adminUsernames: [Admin-User]
gitops:
  discovery:
    owners:
      - type: user
        name: Source-User
        credentialRef: github-read
";

#[test]
fn syntax_diagnostics_locate_the_error_without_echoing_input()
-> Result<(), Box<dyn std::error::Error>> {
    let error = HostConfig::parse("auth: [canary")
        .err()
        .ok_or("expected syntax error")?;
    assert!(error.path.starts_with("config.yaml:"));
    assert!(!format!("{error:?} {error}").contains("canary"));
    Ok(())
}

#[test]
fn validates_and_normalizes_independent_scopes() -> Result<(), Box<dyn std::error::Error>> {
    let config = HostConfig::parse(VALID)?.validate()?;
    assert_eq!(config.cluster_domain, "example.com");
    assert_eq!(config.auth.github.allowed_usernames, ["app-user"]);
    assert_eq!(config.auth.github.admin_usernames, ["admin-user"]);
    assert_eq!(config.gitops.discovery.owners[0].name, "source-user");
    Ok(())
}

#[test]
fn rejects_incomplete_unsafe_and_malformed_configuration() -> Result<(), Box<dyn std::error::Error>>
{
    for (old, new) in [
        ("Example.COM", "../etc"),
        ("Example.COM", "localhost"),
        ("Example.COM", "-bad.example.com"),
        ("[App-User]", "[]"),
        ("[Admin-User]", "[]"),
        ("[App-User]", "[bad--name]"),
        ("[Admin-User]", "[bad_name]"),
        ("Source-User", "../bad"),
        ("dns-token", "../secret"),
        ("client-id", "''"),
        ("admin@example.com", "invalid"),
        ("staging", "other"),
        ("https://paas.example.com", "http://paas.example.com"),
        ("https://paas.example.com", "https://evil.example.com"),
        (
            "https://paas.example.com",
            "https://user:password@paas.example.com",
        ),
        ("/api/auth/callback", "/api/auth/callback?secret=canary"),
        ("type: user", "type: invalid"),
    ] {
        let result = HostConfig::parse(&VALID.replace(old, new)).and_then(HostConfig::validate);
        assert!(result.is_err(), "accepted replacement for {old}");
    }
    for yaml in [
        "",
        "{}",
        "secret: canary",
        "auth: [canary",
        "clusterDomain: canary\nclusterDomain: other",
    ] {
        let error = HostConfig::parse(yaml)
            .err()
            .ok_or("expected invalid YAML")?;
        assert!(!format!("{error:?} {error}").contains("canary"));
    }
    Ok(())
}

#[test]
fn org_spelling_empty_scopes_and_duplicates() -> Result<(), Box<dyn std::error::Error>> {
    let config = HostConfig::parse(&VALID.replace("type: user", "type: org"))?.validate()?;
    assert_eq!(config.gitops.discovery.owners[0].kind, OwnerType::Org);
    assert!(HostConfig::parse(&VALID.replace("type: user", "type: organization")).is_err());
    let mut config = HostConfig::parse(VALID)?;
    config.gitops.discovery.owners.clear();
    assert!(config.validate().is_err());
    let mut config = HostConfig::parse(VALID)?;
    config
        .gitops
        .discovery
        .owners
        .push(config.gitops.discovery.owners[0].clone());
    assert!(config.validate().is_err());
    let config =
        HostConfig::parse(&VALID.replace("[App-User]", "[App-User, app-user]"))?.validate()?;
    assert_eq!(config.auth.github.allowed_usernames, ["app-user"]);
    Ok(())
}

#[cfg(unix)]
fn files() -> Result<tempfile::TempDir, Box<dyn std::error::Error>> {
    use std::os::unix::fs::PermissionsExt;
    let root = tempfile::tempdir()?;
    std::fs::create_dir(root.path().join("_platform"))?;
    std::fs::write(root.path().join("_platform/config.yaml"), VALID)?;
    let secrets = root.path().join("_platform/secrets.yaml");
    std::fs::write(
        &secrets,
        "dns-token: canary-dns\noauth-secret: canary-oauth\ngithub-read: canary-read\n",
    )?;
    std::fs::set_permissions(secrets, std::fs::Permissions::from_mode(0o600))?;
    Ok(root)
}

#[cfg(unix)]
#[test]
fn loads_named_secrets_without_exposing_values() -> Result<(), Box<dyn std::error::Error>> {
    let root = files()?;
    let loaded = BootstrapConfig::load(root.path())?;
    assert_eq!(
        loaded
            .secret(&loaded.config.auth.github.client_secret_ref)?
            .expose(),
        "canary-oauth"
    );
    let public = serde_json::to_string(&*loaded.config)?;
    assert!(!public.contains("canary"));
    assert!(!format!("{loaded:?}").contains("canary"));
    assert!(
        !format!(
            "{:?}",
            loaded.secret(&loaded.config.auth.github.client_secret_ref)?
        )
        .contains("canary")
    );
    Ok(())
}

#[cfg(unix)]
#[test]
fn missing_insecure_and_invalid_secret_files_fail_closed() -> Result<(), Box<dyn std::error::Error>>
{
    use std::os::unix::fs::{PermissionsExt, symlink};
    let root = files()?;
    let secrets = root.path().join("_platform/secrets.yaml");
    for yaml in [
        "{}",
        "dns-token: ''",
        "dns-token: canary\ndns-token: other",
        "../bad: canary",
        "dns-token: [canary]",
        "dns-token: canary\ninvalid-key!: canary",
    ] {
        std::fs::write(&secrets, yaml)?;
        let error = BootstrapConfig::load(root.path())
            .err()
            .ok_or("expected invalid secrets")?;
        assert!(!format!("{error:?} {error}").contains("canary"));
    }
    let root = files()?;
    let secrets = root.path().join("_platform/secrets.yaml");
    for mode in [0o644, 0o640, 0o666] {
        std::fs::set_permissions(&secrets, std::fs::Permissions::from_mode(mode))?;
        assert!(BootstrapConfig::load(root.path()).is_err());
    }
    std::fs::remove_file(&secrets)?;
    assert!(BootstrapConfig::load(root.path()).is_err());
    symlink("config.yaml", &secrets)?;
    assert!(BootstrapConfig::load(root.path()).is_err());
    let root = tempfile::tempdir()?;
    assert!(BootstrapConfig::load(root.path()).is_err());
    Ok(())
}

#[cfg(unix)]
#[test]
fn missing_references_identify_the_configuration_field() -> Result<(), Box<dyn std::error::Error>> {
    for (reference, path) in [
        ("dns-token", "tls.digitalOceanTokenRef"),
        ("oauth-secret", "auth.github.clientSecretRef"),
        ("github-read", "gitops.discovery.owners[0].credentialRef"),
    ] {
        let root = files()?;
        std::fs::write(
            root.path().join("_platform/config.yaml"),
            VALID.replace(reference, "missing"),
        )?;
        let error = BootstrapConfig::load(root.path())
            .err()
            .ok_or("expected missing reference")?;
        assert_eq!(error.path, path);
        assert!(error.problem.contains("secrets.yaml"));
    }
    Ok(())
}

#[cfg(unix)]
#[test]
fn rejects_escaped_directories_nonregular_and_oversized_files()
-> Result<(), Box<dyn std::error::Error>> {
    use std::os::unix::fs::symlink;
    let root = files()?;
    let outer = tempfile::tempdir()?;
    symlink(
        root.path().join("_platform"),
        outer.path().join("_platform"),
    )?;
    assert!(BootstrapConfig::load(outer.path()).is_err());
    let config = root.path().join("_platform/config.yaml");
    std::fs::remove_file(&config)?;
    std::fs::create_dir(&config)?;
    assert!(BootstrapConfig::load(root.path()).is_err());
    std::fs::remove_dir(&config)?;
    std::fs::write(&config, vec![b' '; MAX_FILE_BYTES + 1])?;
    assert!(BootstrapConfig::load(root.path()).is_err());
    std::fs::write(&config, VALID)?;
    let secrets = root.path().join("_platform/secrets.yaml");
    std::fs::write(&secrets, vec![b' '; MAX_FILE_BYTES + 1])?;
    assert!(BootstrapConfig::load(root.path()).is_err());
    assert!(HostConfig::parse(&" ".repeat(MAX_FILE_BYTES + 1)).is_err());
    Ok(())
}
