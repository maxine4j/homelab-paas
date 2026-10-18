use super::*;
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct TestDesired {
    resources: Vec<String>,
}
impl DesiredState for TestDesired {
    fn validate(&self) -> Result<(), StoreError> {
        if self.resources.is_empty()
            || self.resources.len() > 16
            || self
                .resources
                .iter()
                .any(|id| id.is_empty() || id.len() > 128)
        {
            return Err(StoreError::InvalidSnapshot);
        }
        Ok(())
    }
}
type Store = super::Store<TestDesired>;
type Writer = super::Writer<TestDesired>;
type Snapshot = super::Snapshot<TestDesired>;
type Record = super::Record<TestDesired>;
type RecordData = super::RecordData<TestDesired>;
fn decode(bytes: &[u8]) -> Result<Snapshot, StoreError> {
    super::decode(bytes)
}
fn intent() -> OperationIntent {
    OperationIntent {
        action: OperationAction::Create,
        target_record_id: "service-one".into(),
        desired_generation: 1,
        idempotency_key: "operation-one".into(),
    }
}
type TestResult = Result<(), Box<dyn std::error::Error>>;
fn reservation() -> Record {
    Record {
        id: "service-one".into(),
        version: 1,
        generation: 1,
        data: RecordData::Reservation {
            service_id: "service-one".into(),
            name: "service-one".into(),
        },
    }
}
fn operation() -> Record {
    Record {
        id: "op-one".into(),
        version: 1,
        generation: 1,
        data: RecordData::Operation {
            service_id: "service-one".into(),
            intent: intent(),
            state: OperationState::Pending,
        },
    }
}
#[tokio::test]
async fn durable_commit_restart_and_stale_requests() -> TestResult {
    let root = tempfile::tempdir()?;
    let store = Store::open(root.path(), "install", "cluster", true).await?;
    assert_eq!(store.snapshot().generation, 0);
    let state = store.commit(0, vec![reservation(), operation()]).await?;
    assert_eq!(state.generation, 1);
    assert!(matches!(
        store.commit(0, vec![]).await,
        Err(StoreError::StaleGeneration)
    ));
    store.shutdown().await?;
    let store = Store::open(root.path(), "install", "cluster", false).await?;
    assert_eq!(*store.snapshot(), *state);
    assert!(
        matches!(store.commit(1, vec![reservation(), operation()]).await, Ok(s) if s.generation == 2)
    );
    store.shutdown().await?;
    Ok(())
}
#[tokio::test]
async fn lifetime_lock_binding_and_missing_existing_state() -> TestResult {
    let root = tempfile::tempdir()?;
    assert!(matches!(
        Store::open(root.path(), "i", "c", false).await,
        Err(StoreError::RecoveryRequired)
    ));
    let store = Store::open(root.path(), "i", "c", true).await?;
    assert!(matches!(
        Store::open(root.path(), "i", "c", false).await,
        Err(StoreError::AlreadyRunning)
    ));
    store.shutdown().await?;
    assert!(matches!(
        Store::open(root.path(), "other", "c", false).await,
        Err(StoreError::BindingMismatch)
    ));
    std::fs::remove_file(root.path().join("_platform/state/controller.yaml"))?;
    assert!(matches!(
        Store::open(root.path(), "i", "c", true).await,
        Err(StoreError::RecoveryRequired)
    ));
    Ok(())
}
#[tokio::test]
async fn rejects_invalid_references_duplicate_ids_and_secret_fields() -> TestResult {
    let root = tempfile::tempdir()?;
    let store = Store::open(root.path(), "i", "c", true).await?;
    for records in [vec![operation()], vec![reservation(), reservation()]] {
        assert!(matches!(
            store.commit(0, records).await,
            Err(StoreError::InvalidSnapshot)
        ));
    }
    let mut invalid = reservation();
    invalid.version = 9;
    assert!(matches!(
        store.commit(0, vec![invalid]).await,
        Err(StoreError::UnsupportedVersion(9))
    ));
    store.shutdown().await?;
    let path = root.path().join("_platform/state/controller.yaml");
    let yaml = std::fs::read_to_string(&path)?;
    for bad in [
        format!("{yaml}\npassword: secret\n"),
        format!("{yaml}\ngeneration: 999\n"),
        "[broken".into(),
    ] {
        std::fs::write(&path, bad)?;
        assert!(matches!(
            Store::open(root.path(), "i", "c", false).await,
            Err(StoreError::InvalidSnapshot)
        ));
    }
    Ok(())
}

#[tokio::test]
async fn migrates_whole_snapshot_after_restrictive_backup() -> TestResult {
    let root = tempfile::tempdir()?;
    let store = Store::open(root.path(), "i", "c", true).await?;
    let committed = store.commit(0, vec![reservation(), operation()]).await?;
    store.shutdown().await?;
    let path = root.path().join("_platform/state/controller.yaml");
    let mut old = (*committed).clone();
    old.schema_version = 1;
    std::fs::write(&path, encode(&old)?)?;
    let store = Store::open(root.path(), "i", "c", false).await?;
    assert_eq!(store.snapshot().schema_version, 2);
    assert_eq!(store.snapshot().generation, 2);
    assert_eq!(store.snapshot().records, old.records);
    let backup = root
        .path()
        .join("_platform/state/controller-v1-1.backup.yaml");
    assert_eq!(decode(&std::fs::read(&backup)?)?, old);
    assert_eq!(
        std::fs::metadata(&backup)?.permissions().mode() & 0o777,
        0o600
    );
    store.shutdown().await?;
    // A crash after backup publication resumes using the validated backup.
    std::fs::write(&path, encode(&old)?)?;
    let store = Store::open(root.path(), "i", "c", false).await?;
    assert_eq!(store.snapshot().schema_version, 2);
    store.shutdown().await?;
    std::fs::write(&path, encode(&old)?)?;
    // Conflicting backups are never overwritten or restored automatically.
    std::fs::write(backup, b"corrupt backup")?;
    assert!(Store::open(root.path(), "i", "c", false).await.is_err());
    assert_eq!(decode(&std::fs::read(path)?)?, old);
    Ok(())
}

#[tokio::test]
async fn rejects_capacity_unsafe_paths_versions_and_stale_record_edits() -> TestResult {
    let root = tempfile::tempdir()?;
    let store = Store::open(root.path(), "i", "c", true).await?;
    store.commit(0, vec![reservation(), operation()]).await?;
    let mut changed = operation();
    changed.data = RecordData::Operation {
        service_id: "service-one".into(),
        intent: intent(),
        state: OperationState::Succeeded,
    };
    assert!(matches!(
        store.commit(1, vec![reservation(), changed.clone()]).await,
        Err(StoreError::StaleGeneration)
    ));
    changed.generation = 2;
    store.commit(1, vec![reservation(), changed]).await?;
    assert!(matches!(
        store.commit(2, vec![reservation(); MAX_RECORDS + 1]).await,
        Err(StoreError::Capacity)
    ));
    store.shutdown().await?;
    let path = root.path().join("_platform/state/controller.yaml");
    let mut snapshot = decode(&std::fs::read(&path)?)?;
    snapshot.schema_version = 99;
    std::fs::write(&path, encode(&snapshot)?)?;
    assert!(matches!(
        Store::open(root.path(), "i", "c", false).await,
        Err(StoreError::UnsupportedVersion(99))
    ));
    std::fs::remove_file(&path)?;
    std::os::unix::fs::symlink(root.path().join("outside"), &path)?;
    assert!(Store::open(root.path(), "i", "c", false).await.is_err());
    Ok(())
}

#[test]
fn interrupted_commits_recover_only_complete_committed_path_and_halt_writer() -> TestResult {
    for fault in [
        Fault::Write,
        Fault::FileSync,
        Fault::Rename,
        Fault::DirectorySync,
        Fault::LostResponse,
    ] {
        let root = tempfile::tempdir()?;
        let mut writer = Writer::open(root.path(), "i", "c", true)?;
        writer.fault = Some(fault);
        assert!(
            writer.commit(0, vec![reservation(), operation()]).is_err(),
            "{fault:?}"
        );
        assert_eq!(writer.current.generation, 0);
        assert!(matches!(writer.commit(0, vec![]), Err(StoreError::Halted)));
        drop(writer);
        let recovered = Writer::open(root.path(), "i", "c", false)?;
        let renamed = matches!(fault, Fault::DirectorySync | Fault::LostResponse);
        assert_eq!(recovered.current.generation, u64::from(renamed));
        assert_eq!(recovered.current.records.len(), if renamed { 2 } else { 0 });
    }
    Ok(())
}

#[test]
fn full_unwritable_storage_and_abandoned_temporaries_fail_closed() -> TestResult {
    let root = tempfile::tempdir()?;
    let mut writer = Writer::open(root.path(), "i", "c", true)?;
    // Actual filesystem refusal before rename: the exclusive temporary pathname exists.
    let temporary = root.path().join(format!(
        "_platform/state/.controller-{}-2.tmp",
        std::process::id()
    ));
    std::fs::write(&temporary, b"abandoned partial write")?;
    assert!(matches!(
        writer.commit(0, vec![reservation()]),
        Err(StoreError::Io(std::io::ErrorKind::AlreadyExists))
    ));
    drop(writer);
    let writer = Writer::open(root.path(), "i", "c", false)?;
    assert_eq!(writer.current.generation, 0);
    assert!(!temporary.exists());
    drop(writer);
    std::fs::set_permissions(
        root.path().join("_platform/state"),
        std::fs::Permissions::from_mode(0o500),
    )?;
    assert!(matches!(
        Writer::open(root.path(), "i", "c", false),
        Err(StoreError::Io(std::io::ErrorKind::PermissionDenied))
    ));
    Ok(())
}

#[tokio::test]
async fn records_keep_identity_targets_and_validated_metadata() -> TestResult {
    let root = tempfile::tempdir()?;
    let store = Store::open(root.path(), "i", "c", true).await?;
    let approved = Record {
        id: "approval-one".into(),
        version: 1,
        generation: 1,
        data: RecordData::Approval {
            service_id: "service-one".into(),
            administrator: "owner".into(),
            revision: "commit-one".into(),
        },
    };
    let invalid = Record {
        data: RecordData::Desired {
            service_id: "service-one".into(),
            revision: "commit-one".into(),
            digest: "digest".into(),
            snapshot: TestDesired { resources: vec![] },
        },
        ..approved.clone()
    };
    assert!(matches!(
        store.commit(0, vec![reservation(), invalid]).await,
        Err(StoreError::InvalidSnapshot)
    ));
    store
        .commit(0, vec![reservation(), approved.clone()])
        .await?;
    let changed_kind = Record {
        generation: 2,
        data: operation().data,
        ..approved.clone()
    };
    assert!(matches!(
        store.commit(1, vec![reservation(), changed_kind]).await,
        Err(StoreError::InvalidSnapshot)
    ));
    let changed_service = Record {
        generation: 2,
        data: RecordData::Reservation {
            service_id: "service-one".into(),
            name: "renamed".into(),
        },
        ..reservation()
    };
    assert!(matches!(
        store.commit(1, vec![changed_service, approved]).await,
        Err(StoreError::InvalidSnapshot)
    ));
    store.shutdown().await?;
    Ok(())
}

#[test]
fn malformed_fields_and_snapshot_size_are_bounded() -> TestResult {
    let mut snapshot = Snapshot {
        schema_version: 2,
        generation: 0,
        installation_id: "i".into(),
        cluster_id: "c".into(),
        records: vec![reservation()],
    };
    snapshot.records.push(Record {
        id: "a".into(),
        version: 1,
        generation: 1,
        data: RecordData::Approval {
            service_id: "service-one".into(),
            administrator: "".into(),
            revision: "".into(),
        },
    });
    assert!(matches!(
        validate(&snapshot),
        Err(StoreError::InvalidSnapshot)
    ));
    assert!(matches!(
        decode(&vec![b' '; MAX_BYTES + 1]),
        Err(StoreError::Capacity)
    ));
    Ok(())
}

#[test]
fn inventory_targets_and_ownership_tokens_are_unique() -> TestResult {
    let inventory = Record {
        id: "object-one".into(),
        version: 1,
        generation: 1,
        data: RecordData::Inventory {
            service_id: "service-one".into(),
            target: ObjectTarget {
                api_group: "apps".into(),
                resource: "deployments".into(),
                api_version: "v1".into(),
                kind: "Deployment".into(),
                namespace: Some("service-one".into()),
                name: "web".into(),
            },
            ownership_token: "token-one".into(),
            uid: None,
            lifecycle: Lifecycle::Runtime,
        },
    };
    let snapshot = Snapshot {
        schema_version: 2,
        generation: 1,
        installation_id: "i".into(),
        cluster_id: "c".into(),
        records: vec![
            reservation(),
            inventory.clone(),
            Record {
                id: "object-two".into(),
                ..inventory
            },
        ],
    };
    assert!(matches!(
        validate(&snapshot),
        Err(StoreError::InvalidSnapshot)
    ));
    Ok(())
}

#[test]
#[ignore = "subprocess helper for OS-lock test"]
fn lock_holder_process() -> TestResult {
    let root = std::env::var_os("CP04_LOCK_TEST_ROOT").ok_or("missing subprocess root")?;
    let _writer = Writer::open(Path::new(&root), "i", "c", true)?;
    std::fs::write(Path::new(&root).join("ready"), b"locked")?;
    loop {
        std::thread::sleep(std::time::Duration::from_secs(1));
    }
}

#[test]
fn competing_process_is_excluded_and_crash_releases_lock() -> TestResult {
    struct Child(std::process::Child);
    impl Drop for Child {
        fn drop(&mut self) {
            let _ = self.0.kill();
            let _ = self.0.wait();
        }
    }
    let root = tempfile::tempdir()?;
    let mut child = Child(
        std::process::Command::new(std::env::current_exe()?)
            .args([
                "--exact",
                "persistence::tests::lock_holder_process",
                "--ignored",
            ])
            .env("CP04_LOCK_TEST_ROOT", root.path())
            .stdout(std::process::Stdio::null())
            .spawn()?,
    );
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(10);
    while !root.path().join("ready").exists() {
        if std::time::Instant::now() >= deadline {
            return Err("lock helper did not start".into());
        }
        if child.0.try_wait()?.is_some() {
            return Err("lock helper exited".into());
        }
        std::thread::sleep(std::time::Duration::from_millis(10));
    }
    assert!(matches!(
        Writer::open(root.path(), "i", "c", false),
        Err(StoreError::AlreadyRunning)
    ));
    child.0.kill()?;
    child.0.wait()?;
    let recovered = Writer::open(root.path(), "i", "c", false)?;
    assert_eq!(recovered.current.installation_id, "i");
    Ok(())
}

#[tokio::test]
async fn desired_content_is_committed_inside_the_snapshot() -> TestResult {
    let root = tempfile::tempdir()?;
    let store = Store::open(root.path(), "i", "c", true).await?;
    let desired = Record {
        id: "desired-one".into(),
        version: 1,
        generation: 1,
        data: RecordData::Desired {
            service_id: "service-one".into(),
            revision: "commit-one".into(),
            digest: "digest-one".into(),
            snapshot: TestDesired {
                resources: vec!["web".into()],
            },
        },
    };
    let snapshot = store.commit(0, vec![reservation(), desired]).await?;
    store.shutdown().await?;
    let yaml = std::fs::read_to_string(root.path().join("_platform/state/controller.yaml"))?;
    assert!(yaml.contains("resources:"));
    let store = Store::open(root.path(), "i", "c", false).await?;
    assert_eq!(*store.snapshot(), *snapshot);
    store.shutdown().await?;
    Ok(())
}

#[tokio::test]
async fn operation_intent_is_referenced_unique_and_immutable() -> TestResult {
    let root = tempfile::tempdir()?;
    let store = Store::open(root.path(), "i", "c", true).await?;
    let mut invalid = operation();
    if let RecordData::Operation { intent, .. } = &mut invalid.data {
        intent.target_record_id = "absent".into();
    }
    assert!(matches!(
        store.commit(0, vec![reservation(), invalid]).await,
        Err(StoreError::InvalidSnapshot)
    ));
    let duplicate = Record {
        id: "op-two".into(),
        ..operation()
    };
    assert!(matches!(
        store
            .commit(0, vec![reservation(), operation(), duplicate])
            .await,
        Err(StoreError::InvalidSnapshot)
    ));
    store.commit(0, vec![reservation(), operation()]).await?;
    let mut altered = operation();
    altered.generation = 2;
    if let RecordData::Operation { intent, .. } = &mut altered.data {
        intent.action = OperationAction::Delete;
    }
    assert!(matches!(
        store.commit(1, vec![reservation(), altered]).await,
        Err(StoreError::InvalidSnapshot)
    ));
    store.shutdown().await?;
    Ok(())
}

#[tokio::test]
async fn durability_failure_closes_effect_gate_and_shutdown_drains_lost_responses() -> TestResult {
    let root = tempfile::tempdir()?;
    let mut writer = Writer::open(root.path(), "i", "c", true)?;
    writer.fault = Some(Fault::DirectorySync);
    let store = Store::start(writer);
    store.ensure_writable()?;
    assert!(matches!(
        store.commit(0, vec![reservation(), operation()]).await,
        Err(StoreError::IndeterminateCommit)
    ));
    assert!(matches!(store.ensure_writable(), Err(StoreError::Halted)));
    store.shutdown().await?;
    let store = Store::open(root.path(), "i", "c", false).await?;
    let (reply, response) = oneshot::channel();
    store
        .sender
        .try_send(Command::Commit(1, vec![reservation(), operation()], reply))
        .map_err(|_| "enqueue failed")?;
    drop(response);
    store.shutdown().await?;
    let store = Store::open(root.path(), "i", "c", false).await?;
    assert_eq!(store.snapshot().generation, 2);
    assert_eq!(store.snapshot().records.len(), 2);
    store.shutdown().await?;
    Ok(())
}
