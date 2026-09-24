use adblock::cosmetic_filter_cache::UrlSpecificResources;
use serde::{Deserialize, Serialize};

/// Cosmetic filtering resources extracted for a specific webpage URL.
///
/// Contains CSS selectors to hide, scriptlets to execute, and flags indicating
/// whether generic cosmetic rules apply.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
pub struct CosmeticResources {
    /// CSS selectors that should be hidden on the page (`display: none !important;`).
    pub hide_selectors: Vec<String>,
    /// JavaScript scriptlet source code to be injected into the page context.
    pub injected_script: String,
    /// Whether generic cosmetic hiding rules should be applied on dynamic mutations.
    /// If `true`, dynamic DOM classes and IDs should be queried via `get_hidden_selectors`.
    pub generics: bool,
    /// Procedural action rules (e.g. uBlock-style `:has()`, `:xpath()`) if present.
    pub procedural_actions: Vec<String>,
    /// CSS class and ID exceptions for generic rules.
    pub exceptions: Vec<String>,
}

impl CosmeticResources {
    /// Create an empty set of cosmetic resources.
    pub fn empty() -> Self {
        Self {
            hide_selectors: Vec::new(),
            injected_script: String::new(),
            generics: true,
            procedural_actions: Vec::new(),
            exceptions: Vec::new(),
        }
    }

    /// Convert adblock crate's [`UrlSpecificResources`] into [`CosmeticResources`].
    pub fn from_url_resources(resources: &UrlSpecificResources) -> Self {
        let mut hide_selectors: Vec<String> = resources.hide_selectors.iter().cloned().collect();
        hide_selectors.sort();

        let mut procedural_actions: Vec<String> =
            resources.procedural_actions.iter().cloned().collect();
        procedural_actions.sort();

        let mut exceptions: Vec<String> = resources.exceptions.iter().cloned().collect();
        exceptions.sort();

        Self {
            hide_selectors,
            injected_script: resources.injected_script.clone(),
            // In adblock-rust, `generichide: true` means generic hiding is disabled (excepted).
            // Therefore, `generics` is true when `generichide` is false.
            generics: !resources.generichide,
            procedural_actions,
            exceptions,
        }
    }

    /// Convert hide selectors into a CSS stylesheet string.
    pub fn to_css(&self) -> String {
        if self.hide_selectors.is_empty() {
            return String::new();
        }
        format!(
            "{} {{ display: none !important; }}",
            self.hide_selectors.join(",\n")
        )
    }

    /// Generate an HTML `<style>` block containing the cosmetic CSS rules.
    pub fn to_style_tag(&self) -> String {
        let css = self.to_css();
        if css.is_empty() {
            String::new()
        } else {
            format!("<style id=\"avalaunch-cosmetic-shield\">{}</style>", css)
        }
    }
}

impl From<UrlSpecificResources> for CosmeticResources {
    fn from(res: UrlSpecificResources) -> Self {
        Self::from_url_resources(&res)
    }
}

impl From<&UrlSpecificResources> for CosmeticResources {
    fn from(res: &UrlSpecificResources) -> Self {
        Self::from_url_resources(res)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_cosmetic_resources_empty() {
        let empty = CosmeticResources::empty();
        assert!(empty.hide_selectors.is_empty());
        assert!(empty.injected_script.is_empty());
        assert!(empty.generics);
        assert!(empty.to_css().is_empty());
        assert!(empty.to_style_tag().is_empty());
    }

    #[test]
    fn test_cosmetic_resources_from_url_resources() {
        let mut raw = UrlSpecificResources::empty();
        raw.hide_selectors.insert(".ad-banner".to_string());
        raw.hide_selectors.insert("#sponsored".to_string());
        raw.injected_script = "console.log('ad-defused');".to_string();
        raw.generichide = false;

        let cosmetic = CosmeticResources::from_url_resources(&raw);
        assert_eq!(cosmetic.hide_selectors.len(), 2);
        assert_eq!(cosmetic.injected_script, "console.log('ad-defused');");
        assert!(cosmetic.generics);

        let css = cosmetic.to_css();
        assert!(css.contains("{ display: none !important; }"));
        assert!(css.contains(".ad-banner"));
        assert!(css.contains("#sponsored"));
    }

    #[test]
    fn test_generichide_flag() {
        let mut raw = UrlSpecificResources::empty();
        raw.generichide = true;
        let cosmetic = CosmeticResources::from_url_resources(&raw);
        assert!(!cosmetic.generics);
    }
}
