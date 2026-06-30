# Plan multi-club + collaboratori

Partiamo senza dominio: useremo un **selector di club** al login. Quando avrai il dominio, attiveremo i sottodomini senza rompere nulla.

## 1. Database multi-tenant

- Tabella `clubs` (nome, slug, logo_url, città, attivo).
- Aggiungere `club_id` a: `members`, `membership_plans`, `products`, `product_categories`, `orders`, `order_items`, `user_roles`.
- Funzione `current_club_id()` (security definer) che legge il club attivo dell'utente da `user_roles`.
- RLS: ogni SELECT/INSERT/UPDATE filtra per `club_id = current_club_id()`.
- Super-admin (tu): nuovo ruolo `super_admin` in `app_role` che bypassa il filtro e vede tutti i club.
- Trigger `tg_assign_member_number`: numerazione sequenziale **per club** (sequenza per club_id).

## 2. Super-admin Snoop

- Nuova route `/snoop-admin` (solo `super_admin`):
  - Lista club + pulsante **Crear club** (nome, slug, logo upload).
  - Per ogni club: pulsante **Crear admin** (email + nome → crea utente + invia email con password temporanea + link reset).
- Home `/`: se sei super_admin vedi griglia di club; cliccando entri come admin di quel club.

## 3. Login & selector club

- Se l'utente ha 1 solo club → entra diretto.
- Se ne ha più di uno → schermata "Selecciona club" con logo + nome.
- Home del club: mostra logo del club + "WELCOME {NOME_CLUB}".

## 4. Collaboratori (dentro Soci)

Aggiungere nel menu **Soci** la voce **Crear colaborador**:
- Form: nome, email, telefono, permessi (checkbox):
  - `create_members` (Crear socio)
  - `manage_members` (Gestionar socios y pedidos)
  - `manage_stock` (Gestionar stock/productos)
  - `create_collaborators` (solo admin di default)
- Al salvataggio:
  - Crea utente in auth con password temporanea random.
  - Inserisce in `user_roles` con `role='collaborator'`, `permissions=[...]`, `club_id`.
  - Manda email con username + password temporanea + link a `/reset-password`.
- Voce **Gestionar colaboradores**: lista, edita permessi, disattiva.

## 5. UI gating per permessi

- `SnoopLayout` e Home mostrano solo le voci consentite dai `permissions` dell'utente.
- Admin del club vede tutto; collaboratore vede solo ciò che gli è stato concesso.

## 6. Preparazione futuro dominio

- Aggiungere `clubs.slug` univoco già da ora.
- Helper `resolveClubFromHost()` che oggi ritorna `null` (fallback al selector) ma domani leggerà `meduza.snoop.app` dal subdomain. Zero rifattorizzazione futura.

## Ordine di esecuzione

1. Migration: `clubs`, colonne `club_id`, `super_admin`, `current_club_id()`, nuove RLS, sequenze per-club, ruolo `collaborator`.
2. Seed: crea club **MEDUZA XXIII** e assegna te come admin + super_admin; backfill dei dati esistenti con questo `club_id`.
3. Route `/snoop-admin` + creazione club/admin con invio email.
4. Selector club al login + home dinamica con logo del club.
5. Pagine **Crear/Gestionar colaboradores** con email di benvenuto.
6. Gating UI per permessi.

Confermi che parto da 1+2 (migration + seed del tuo club)? Una volta approvata la migration, vado dritto sul resto.
