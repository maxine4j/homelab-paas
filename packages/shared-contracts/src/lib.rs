//! Canonical public contracts. No I/O, secrets, or service adapters belong here.

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

/// A named host credential reference, never its resolved value.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, JsonSchema)]
#[serde(transparent)]
pub struct CredentialReference(#[schemars(length(min = 1))] String);

impl AsRef<str> for CredentialReference {
    fn as_ref(&self) -> &str {
        &self.0
    }
}

impl TryFrom<String> for CredentialReference {
    type Error = ValidationCode;

    fn try_from(value: String) -> Result<Self, Self::Error> {
        if value.is_empty() {
            return Err(ValidationCode::Required);
        }
        Ok(Self(value))
    }
}

impl<'de> Deserialize<'de> for CredentialReference {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        Self::try_from(String::deserialize(deserializer)?)
            .map_err(|_| serde::de::Error::custom("credential reference is required"))
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum ErrorCode {
    InvalidRequest,
    NotFound,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum ValidationCode {
    Required,
}

/// Field paths and stable codes are safe for public diagnostics; rejected values are omitted.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct FieldDiagnostic {
    pub path: String,
    pub code: ValidationCode,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct ApiError {
    pub code: ErrorCode,
    pub diagnostics: Vec<FieldDiagnostic>,
}

/// Export only public wire models, using draft 7 for browser tooling compatibility.
pub fn schemas() -> std::collections::BTreeMap<&'static str, schemars::Schema> {
    let settings = schemars::generate::SchemaSettings::draft07();
    std::collections::BTreeMap::from([
        (
            "CredentialReference",
            settings
                .clone()
                .into_generator()
                .into_root_schema_for::<CredentialReference>(),
        ),
        (
            "ApiError",
            settings.into_generator().into_root_schema_for::<ApiError>(),
        ),
    ])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[derive(Deserialize)]
    struct Fixture {
        contract: String,
        valid: bool,
        value: serde_json::Value,
    }

    #[test]
    fn credential_reference_preserves_its_name() -> Result<(), Box<dyn std::error::Error>> {
        let reference: CredentialReference = serde_json::from_str("\"github-read\"")?;
        assert_eq!(reference.as_ref(), "github-read");
        assert_eq!(serde_json::to_value(reference)?, "github-read");
        Ok(())
    }

    #[test]
    fn public_contract_fixtures() -> Result<(), Box<dyn std::error::Error>> {
        let fixtures: Vec<Fixture> = serde_json::from_str(include_str!("../tests/fixtures.json"))?;
        for fixture in fixtures {
            let accepted = match fixture.contract.as_str() {
                "CredentialReference" => {
                    serde_json::from_value::<CredentialReference>(fixture.value.clone()).is_ok()
                }
                "ApiError" => serde_json::from_value::<ApiError>(fixture.value.clone()).is_ok(),
                _ => return Err("unknown fixture contract".into()),
            };
            assert_eq!(
                accepted, fixture.valid,
                "{}: {}",
                fixture.contract, fixture.value
            );
        }
        Ok(())
    }
}
