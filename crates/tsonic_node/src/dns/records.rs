#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MxRecord {
    pub priority: u16,
    pub exchange: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SrvRecord {
    pub priority: u16,
    pub weight: u16,
    pub port: u16,
    pub name: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CaaRecord {
    pub critical: u8,
    pub issue: Option<String>,
    pub issue_wild: Option<String>,
    pub iodef: Option<String>,
    pub contact_email: Option<String>,
    pub contact_phone: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NaptrRecord {
    pub flags: String,
    pub service: String,
    pub regexp: String,
    pub replacement: String,
    pub order: u16,
    pub preference: u16,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SoaRecord {
    pub nsname: String,
    pub hostmaster: String,
    pub serial: u32,
    pub refresh: u32,
    pub retry: u32,
    pub expire: u32,
    pub minttl: u32,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TlsaRecord {
    pub cert_usage: u8,
    pub selector: u8,
    pub match_type: u8,
    pub data: Vec<u8>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AnyARecord {
    pub address: String,
}

impl AnyARecord {
    pub fn record_type(&self) -> &'static str {
        "A"
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AnyAaaaRecord {
    pub address: String,
}

impl AnyAaaaRecord {
    pub fn record_type(&self) -> &'static str {
        "AAAA"
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AnyCnameRecord {
    pub value: String,
}

impl AnyCnameRecord {
    pub fn record_type(&self) -> &'static str {
        "CNAME"
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AnyNsRecord {
    pub value: String,
}

impl AnyNsRecord {
    pub fn record_type(&self) -> &'static str {
        "NS"
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AnyPtrRecord {
    pub value: String,
}

impl AnyPtrRecord {
    pub fn record_type(&self) -> &'static str {
        "PTR"
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AnyMxRecord {
    pub priority: u16,
    pub exchange: String,
}

impl AnyMxRecord {
    pub fn record_type(&self) -> &'static str {
        "MX"
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AnySrvRecord {
    pub priority: u16,
    pub weight: u16,
    pub port: u16,
    pub name: String,
}

impl AnySrvRecord {
    pub fn record_type(&self) -> &'static str {
        "SRV"
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AnyTxtRecord {
    pub entries: Vec<String>,
}

impl AnyTxtRecord {
    pub fn record_type(&self) -> &'static str {
        "TXT"
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AnySoaRecord {
    pub nsname: String,
    pub hostmaster: String,
    pub serial: u32,
    pub refresh: u32,
    pub retry: u32,
    pub expire: u32,
    pub minttl: u32,
}

impl AnySoaRecord {
    pub fn record_type(&self) -> &'static str {
        "SOA"
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AnyCaaRecord {
    pub critical: u8,
    pub issue: Option<String>,
    pub issue_wild: Option<String>,
    pub iodef: Option<String>,
    pub contact_email: Option<String>,
    pub contact_phone: Option<String>,
}

impl AnyCaaRecord {
    pub fn record_type(&self) -> &'static str {
        "CAA"
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AnyNaptrRecord {
    pub flags: String,
    pub service: String,
    pub regexp: String,
    pub replacement: String,
    pub order: u16,
    pub preference: u16,
}

impl AnyNaptrRecord {
    pub fn record_type(&self) -> &'static str {
        "NAPTR"
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AnyTlsaRecord {
    pub cert_usage: u8,
    pub selector: u8,
    pub match_type: u8,
    pub data: Vec<u8>,
}

impl AnyTlsaRecord {
    pub fn record_type(&self) -> &'static str {
        "TLSA"
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AnyRecord {
    A(String),
    Aaaa(String),
    Cname(String),
    Mx(MxRecord),
    Ns(String),
    Ptr(String),
    Soa(SoaRecord),
    Srv(SrvRecord),
    Txt(Vec<String>),
    Caa(CaaRecord),
    Naptr(NaptrRecord),
    Tlsa(TlsaRecord),
}

