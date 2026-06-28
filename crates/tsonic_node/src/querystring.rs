use crate::url::UrlSearchParams;

pub fn parse(value: &str) -> UrlSearchParams {
    UrlSearchParams::new(Some(value)).unwrap_or_default()
}

pub fn stringify(params: &UrlSearchParams) -> String {
    params.to_string()
}
