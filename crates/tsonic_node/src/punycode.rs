const BASE: u32 = 36;
const TMIN: u32 = 1;
const TMAX: u32 = 26;
const SKEW: u32 = 38;
const DAMP: u32 = 700;
const INITIAL_BIAS: u32 = 72;
const INITIAL_N: u32 = 128;
const DELIMITER: char = '-';

pub fn to_ascii(domain: &str) -> String {
    domain
        .split('.')
        .map(|label| {
            if label.is_ascii() {
                label.to_ascii_lowercase()
            } else {
                format!("xn--{}", encode_label(label))
            }
        })
        .collect::<Vec<_>>()
        .join(".")
}

pub fn to_unicode(domain: &str) -> String {
    domain
        .split('.')
        .map(|label| {
            if let Some(encoded) = label.strip_prefix("xn--") {
                decode_label(encoded).unwrap_or_else(|| label.to_string())
            } else {
                label.to_string()
            }
        })
        .collect::<Vec<_>>()
        .join(".")
}

fn encode_label(label: &str) -> String {
    let input = label.chars().map(|ch| ch as u32).collect::<Vec<_>>();
    let mut output = String::new();
    for &code in &input {
        if code < 0x80 {
            output.push(char::from_u32(code).unwrap());
        }
    }
    let basic_len = output.chars().count() as u32;
    let mut handled = basic_len;
    if basic_len > 0 && handled < input.len() as u32 {
        output.push(DELIMITER);
    }

    let mut n = INITIAL_N;
    let mut delta = 0_u32;
    let mut bias = INITIAL_BIAS;
    while handled < input.len() as u32 {
        let mut m = u32::MAX;
        for &code in &input {
            if code >= n && code < m {
                m = code;
            }
        }
        delta = delta.saturating_add((m - n).saturating_mul(handled + 1));
        n = m;
        for &code in &input {
            if code < n {
                delta = delta.saturating_add(1);
            } else if code == n {
                let mut q = delta;
                let mut k = BASE;
                loop {
                    let t = if k <= bias {
                        TMIN
                    } else if k >= bias + TMAX {
                        TMAX
                    } else {
                        k - bias
                    };
                    if q < t {
                        break;
                    }
                    output.push(encode_digit(t + ((q - t) % (BASE - t))));
                    q = (q - t) / (BASE - t);
                    k += BASE;
                }
                output.push(encode_digit(q));
                bias = adapt(delta, handled + 1, handled == basic_len);
                delta = 0;
                handled += 1;
            }
        }
        delta = delta.saturating_add(1);
        n = n.saturating_add(1);
    }
    output
}

fn decode_label(label: &str) -> Option<String> {
    let mut output = Vec::<u32>::new();
    let mut rest = label;
    if let Some(index) = label.rfind('-') {
        for ch in label[..index].chars() {
            if !ch.is_ascii() {
                return None;
            }
            output.push(ch as u32);
        }
        rest = &label[index + 1..];
    }

    let mut n = INITIAL_N;
    let mut i = 0_u32;
    let mut bias = INITIAL_BIAS;
    let mut chars = rest.chars().peekable();
    while chars.peek().is_some() {
        let old_i = i;
        let mut w = 1_u32;
        let mut k = BASE;
        loop {
            let digit = decode_digit(chars.next()?)?;
            i = i.checked_add(digit.checked_mul(w)?)?;
            let t = if k <= bias {
                TMIN
            } else if k >= bias + TMAX {
                TMAX
            } else {
                k - bias
            };
            if digit < t {
                break;
            }
            w = w.checked_mul(BASE - t)?;
            k += BASE;
        }
        let out_len = output.len() as u32 + 1;
        bias = adapt(i - old_i, out_len, old_i == 0);
        n = n.checked_add(i / out_len)?;
        let index = (i % out_len) as usize;
        output.insert(index, n);
        i = index as u32 + 1;
    }

    output.into_iter().map(char::from_u32).collect()
}

fn adapt(delta: u32, points: u32, first_time: bool) -> u32 {
    let mut delta = if first_time { delta / DAMP } else { delta / 2 };
    delta += delta / points;
    let mut k = 0;
    while delta > ((BASE - TMIN) * TMAX) / 2 {
        delta /= BASE - TMIN;
        k += BASE;
    }
    k + (((BASE - TMIN + 1) * delta) / (delta + SKEW))
}

fn encode_digit(value: u32) -> char {
    match value {
        0..=25 => char::from_u32(b'a' as u32 + value).unwrap(),
        26..=35 => char::from_u32(b'0' as u32 + value - 26).unwrap(),
        _ => unreachable!(),
    }
}

fn decode_digit(value: char) -> Option<u32> {
    match value {
        'a'..='z' => Some(value as u32 - 'a' as u32),
        'A'..='Z' => Some(value as u32 - 'A' as u32),
        '0'..='9' => Some(value as u32 - '0' as u32 + 26),
        _ => None,
    }
}
