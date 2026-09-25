use proc_macro::TokenStream;
use quote::quote;
use syn::{parse_macro_input, ItemFn, ItemMod, LitInt};

#[proc_macro_attribute]
pub fn offset(arguments: TokenStream, input: TokenStream) -> TokenStream {
    let amount = parse_macro_input!(arguments as LitInt);
    let mut function = parse_macro_input!(input as ItemFn);
    let body = function.block;
    function.block = syn::parse_quote!({ let result = #body; result + #amount });
    quote!(#function).into()
}

#[proc_macro_attribute]
pub fn module_contract(arguments: TokenStream, input: TokenStream) -> TokenStream {
    if !arguments.is_empty() {
        return syn::Error::new(proc_macro::Span::call_site().into(), "module contract takes no arguments").to_compile_error().into();
    }
    let mut module = parse_macro_input!(input as ItemMod);
    let Some((_, items)) = module.content.as_mut() else {
        return syn::Error::new_spanned(module, "module contract requires an inline module").to_compile_error().into();
    };
    let mut entries = 0;
    for item in items {
        if let syn::Item::Fn(function) = item {
            let mut selected = false;
            let mut shape = false;
            function.attrs.retain(|attribute| {
                if attribute.path().is_ident("entry") {
                    selected = true;
                    return false;
                }
                if attribute.path().is_ident("launch_shape") {
                    let values = attribute.parse_args_with(syn::punctuated::Punctuated::<syn::Meta, syn::Token![,]>::parse_terminated);
                    shape = values.is_ok_and(|values| values.len() == 2 &&
                        values.iter().any(|value| matches!(value, syn::Meta::NameValue(value) if value.path.is_ident("domain") && integer(&value.value) == Some(1))) &&
                        values.iter().any(|value| matches!(value, syn::Meta::NameValue(value) if value.path.is_ident("block") &&
                            matches!(&value.value, syn::Expr::Tuple(tuple) if tuple.elems.iter().map(integer).collect::<Vec<_>>() == vec![Some(256), Some(1), Some(1)]))));
                    return false;
                }
                true
            });
            if selected && shape {
                entries += 1;
            } else if selected || shape {
                return syn::Error::new_spanned(function, "entry requires its exact named tuple contract").to_compile_error().into();
            }
        }
    }
    if entries != 1 {
        return syn::Error::new_spanned(module, "module requires exactly one entry").to_compile_error().into();
    }
    quote!(#module).into()
}

fn integer(expression: &syn::Expr) -> Option<u64> {
    match expression {
        syn::Expr::Lit(syn::ExprLit { lit: syn::Lit::Int(value), .. }) => value.base10_parse().ok(),
        _ => None,
    }
}

#[proc_macro_derive(Probe)]
pub fn probe(input: TokenStream) -> TokenStream {
    let declaration = parse_macro_input!(input as syn::DeriveInput);
    let name = declaration.ident;
    let (implementation, arguments, constraints) = declaration.generics.split_for_impl();
    quote!(impl #implementation #name #arguments #constraints { pub const ATTRIBUTE_PROBE: usize = 7; }).into()
}
