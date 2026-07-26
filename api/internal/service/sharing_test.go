package service

import (
	"context"
	"errors"
	"strings"
	"testing"

	"drop/internal/model"
)

// Two accounts, so "somebody else's drive" is expressible at all.
const (
	alice uint = 1
	bob   uint = 2
)

// seedUsers creates the rows the sharing queries join against. The tree only
// stores ids, but listing what was shared reports who shared it.
func seedUsers(t *testing.T, s *Service) {
	t.Helper()
	for _, u := range []model.User{
		{ID: alice, Email: "alice@ejemplo.com", Name: "Alice", PasswordHash: "x", Role: model.RoleAdmin, Active: true},
		{ID: bob, Email: "bob@ejemplo.com", Name: "Bob", PasswordHash: "x", Role: model.RoleUser, Active: true},
	} {
		if err := s.db.Create(&u).Error; err != nil {
			t.Fatalf("seed user %s: %v", u.Email, err)
		}
	}
}

func aliceDrop(t *testing.T, s *Service, name string) DropDetail {
	t.Helper()
	drop, err := s.UploadDrop(context.Background(), alice, UploadDropInput{
		Title: name,
		Name:  name,
		Files: []UploadFile{uploadFile("index.html", "text/html", "<h1>"+name+"</h1>")},
	})
	if err != nil {
		t.Fatalf("UploadDrop(%s): %v", name, err)
	}
	return drop
}

// TestADriveIsInvisibleToEveryoneElse is the whole point of ownership: without
// it, anyone who could sign in could read and delete everything.
func TestADriveIsInvisibleToEveryoneElse(t *testing.T) {
	ctx := context.Background()
	svc, _ := newTestService(t)
	seedUsers(t, svc)

	drop := aliceDrop(t, svc, "privado")

	// Bob's own root is empty even though Alice has drops.
	roots, err := svc.List(ctx, bob, Own(""))
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	if len(roots) != 0 {
		t.Fatalf("bob should start with an empty drive, got %d nodes", len(roots))
	}

	// Naming Alice's path in his own drive finds nothing.
	if _, err := svc.GetDrop(ctx, bob, Own(drop.Path)); !errors.Is(err, ErrNotFound) {
		t.Fatalf("expected not found in bob's own drive, got %v", err)
	}

	// Naming her drive explicitly is refused the same way: a miss and a denial
	// have to be indistinguishable, or the error itself maps her tree.
	if _, err := svc.GetDrop(ctx, bob, In(alice, drop.Path)); !errors.Is(err, ErrNotFound) {
		t.Fatalf("expected not found in alice's drive, got %v", err)
	}
	if _, err := svc.List(ctx, bob, In(alice, "")); !errors.Is(err, ErrNotFound) {
		t.Fatal("bob must not be able to enumerate alice's root")
	}
	if err := svc.Delete(ctx, bob, In(alice, drop.Path)); !errors.Is(err, ErrNotFound) {
		t.Fatalf("expected not found deleting someone else's drop, got %v", err)
	}
}

// TestTwoDrivesMayHoldTheSamePath checks the index really is per owner.
func TestTwoDrivesMayHoldTheSamePath(t *testing.T) {
	ctx := context.Background()
	svc, _ := newTestService(t)
	seedUsers(t, svc)

	if _, err := svc.CreateFolder(ctx, alice, Own(""), "Proyectos"); err != nil {
		t.Fatalf("alice: %v", err)
	}
	if _, err := svc.CreateFolder(ctx, bob, Own(""), "Proyectos"); err != nil {
		t.Fatalf("bob should be able to have his own Proyectos: %v", err)
	}
	// The same name twice in one drive is still a collision.
	if _, err := svc.CreateFolder(ctx, alice, Own(""), "Proyectos"); !errors.Is(err, ErrExists) {
		t.Fatalf("expected a collision inside one drive, got %v", err)
	}
}

func TestAViewerReadsAndCannotWrite(t *testing.T) {
	ctx := context.Background()
	svc, _ := newTestService(t)
	seedUsers(t, svc)

	drop := aliceDrop(t, svc, "compartido")
	if _, err := svc.Share(ctx, alice, Own(drop.Path), bob, AccessViewer); err != nil {
		t.Fatalf("Share: %v", err)
	}

	got, err := svc.GetDrop(ctx, bob, In(alice, drop.Path))
	if err != nil {
		t.Fatalf("a viewer should be able to open it: %v", err)
	}
	if got.Access != AccessViewer {
		t.Fatalf("expected viewer access, got %q", got.Access)
	}

	_, err = svc.SaveFile(ctx, bob, In(alice, drop.Path), "otro.html",
		strings.NewReader("<h1>no</h1>"), 11, "text/html")
	if !errors.Is(err, ErrForbidden) {
		t.Fatalf("a viewer must not write, got %v", err)
	}
	if err := svc.Delete(ctx, bob, In(alice, drop.Path)); !errors.Is(err, ErrForbidden) {
		t.Fatalf("a viewer must not delete, got %v", err)
	}
}

func TestAnEditorWritesButCannotDeleteWhatWasShared(t *testing.T) {
	ctx := context.Background()
	svc, _ := newTestService(t)
	seedUsers(t, svc)

	drop := aliceDrop(t, svc, "equipo")
	if _, err := svc.Share(ctx, alice, Own(drop.Path), bob, AccessEditor); err != nil {
		t.Fatalf("Share: %v", err)
	}

	if _, err := svc.SaveFile(ctx, bob, In(alice, drop.Path), "notas.md",
		strings.NewReader("# hola"), 6, "text/markdown"); err != nil {
		t.Fatalf("an editor should be able to write: %v", err)
	}

	// The one thing an editor could do by accident that the owner could not
	// undo: removing the shared thing itself.
	if err := svc.Delete(ctx, bob, In(alice, drop.Path)); !errors.Is(err, ErrForbidden) {
		t.Fatalf("an editor must not delete the shared root, got %v", err)
	}
}

// TestSharingAFolderReachesWhatIsInside checks grants apply to the subtree
// rather than only to the row they were made on.
func TestSharingAFolderReachesWhatIsInside(t *testing.T) {
	ctx := context.Background()
	svc, _ := newTestService(t)
	seedUsers(t, svc)

	if _, err := svc.CreateFolder(ctx, alice, Own(""), "Equipo"); err != nil {
		t.Fatalf("CreateFolder: %v", err)
	}
	drop, err := svc.UploadDrop(ctx, alice, UploadDropInput{
		ParentRef: Own("Equipo"),
		Title:     "dentro",
		Name:      "dentro",
		Files:     []UploadFile{uploadFile("index.html", "text/html", "<h1>x</h1>")},
	})
	if err != nil {
		t.Fatalf("UploadDrop: %v", err)
	}

	if _, err := svc.Share(ctx, alice, Own("Equipo"), bob, AccessEditor); err != nil {
		t.Fatalf("Share: %v", err)
	}

	children, err := svc.List(ctx, bob, In(alice, "Equipo"))
	if err != nil {
		t.Fatalf("bob should be able to list the shared folder: %v", err)
	}
	if len(children) != 1 {
		t.Fatalf("expected the drop inside, got %d children", len(children))
	}
	got, err := svc.GetDrop(ctx, bob, In(alice, drop.Path))
	if err != nil {
		t.Fatalf("the grant should reach inside: %v", err)
	}
	if got.Access != AccessEditor {
		t.Fatalf("expected editor inside a shared folder, got %q", got.Access)
	}
	// Deleting something *inside* what was shared is allowed; only the shared
	// root itself is protected.
	if err := svc.Delete(ctx, bob, In(alice, drop.Path)); err != nil {
		t.Fatalf("an editor should be able to delete inside: %v", err)
	}
}

func TestSharedWithMeListsTheGrantsAndTheirOwner(t *testing.T) {
	ctx := context.Background()
	svc, _ := newTestService(t)
	seedUsers(t, svc)

	drop := aliceDrop(t, svc, "para-bob")
	if _, err := svc.Share(ctx, alice, Own(drop.Path), bob, AccessViewer); err != nil {
		t.Fatalf("Share: %v", err)
	}

	// Alice sees nothing shared with her; the grant runs one way.
	mine, err := svc.ListSharedWithMe(ctx, alice)
	if err != nil {
		t.Fatalf("ListSharedWithMe: %v", err)
	}
	if len(mine) != 0 {
		t.Fatalf("sharing is not symmetric, got %d entries for the owner", len(mine))
	}

	shared, err := svc.ListSharedWithMe(ctx, bob)
	if err != nil {
		t.Fatalf("ListSharedWithMe: %v", err)
	}
	if len(shared) != 1 {
		t.Fatalf("expected one shared entry, got %d", len(shared))
	}
	if shared[0].Owner != alice || shared[0].OwnerEmail != "alice@ejemplo.com" {
		t.Fatalf("the entry should name its owner, got %+v", shared[0])
	}
	if shared[0].Access != AccessViewer {
		t.Fatalf("expected viewer, got %q", shared[0].Access)
	}
}

func TestOnlySomeoneWhoCanShareMaySeeOrChangeWhoHasAccess(t *testing.T) {
	ctx := context.Background()
	svc, _ := newTestService(t)
	seedUsers(t, svc)

	drop := aliceDrop(t, svc, "lista")
	if _, err := svc.Share(ctx, alice, Own(drop.Path), bob, AccessViewer); err != nil {
		t.Fatalf("Share: %v", err)
	}

	if _, err := svc.ListShares(ctx, bob, In(alice, drop.Path)); !errors.Is(err, ErrForbidden) {
		t.Fatalf("a viewer must not see the access list, got %v", err)
	}
	// Nor pass their access on.
	if _, err := svc.Share(ctx, bob, In(alice, drop.Path), 3, AccessViewer); !errors.Is(err, ErrForbidden) {
		t.Fatalf("a viewer must not share, got %v", err)
	}

	shares, err := svc.ListShares(ctx, alice, Own(drop.Path))
	if err != nil {
		t.Fatalf("the owner should see the list: %v", err)
	}
	if len(shares) != 1 || shares[0].UserID != bob {
		t.Fatalf("expected bob on the list, got %+v", shares)
	}

	// Re-granting changes the level rather than failing as a duplicate.
	if _, err := svc.Share(ctx, alice, Own(drop.Path), bob, AccessEditor); err != nil {
		t.Fatalf("re-sharing should update the level: %v", err)
	}
	shares, _ = svc.ListShares(ctx, alice, Own(drop.Path))
	if len(shares) != 1 || shares[0].Access != AccessEditor {
		t.Fatalf("expected exactly one grant, now editor, got %+v", shares)
	}

	if err := svc.Unshare(ctx, alice, Own(drop.Path), bob); err != nil {
		t.Fatalf("Unshare: %v", err)
	}
	if _, err := svc.GetDrop(ctx, bob, In(alice, drop.Path)); !errors.Is(err, ErrNotFound) {
		t.Fatalf("access should be gone after revoking, got %v", err)
	}
}

// TestDeletingASharedNodeTakesItsGrants stops a removed folder from lingering
// in somebody's shared section.
func TestDeletingASharedNodeTakesItsGrants(t *testing.T) {
	ctx := context.Background()
	svc, _ := newTestService(t)
	seedUsers(t, svc)

	drop := aliceDrop(t, svc, "efimero")
	if _, err := svc.Share(ctx, alice, Own(drop.Path), bob, AccessViewer); err != nil {
		t.Fatalf("Share: %v", err)
	}
	if err := svc.Delete(ctx, alice, Own(drop.Path)); err != nil {
		t.Fatalf("Delete: %v", err)
	}

	shared, err := svc.ListSharedWithMe(ctx, bob)
	if err != nil {
		t.Fatalf("ListSharedWithMe: %v", err)
	}
	if len(shared) != 0 {
		t.Fatalf("a deleted node must not stay listed, got %+v", shared)
	}
}

// TestPublishedDropsIgnoreOwnership: a public drop is public. Who owns it and
// who it has been shared with have nothing to say about that.
func TestPublishedDropsIgnoreOwnership(t *testing.T) {
	ctx := context.Background()
	svc, _ := newTestService(t)
	seedUsers(t, svc)

	drop := aliceDrop(t, svc, "publico")
	if _, err := svc.GetDropBySlug(ctx, anonymous, drop.Meta.Slug); err != nil {
		t.Fatalf("a public drop is public to everyone, signed in or not: %v", err)
	}
	if _, err := svc.GetDropBySlug(ctx, bob, drop.Meta.Slug); err != nil {
		t.Fatalf("being signed in as someone else must not take a public drop away: %v", err)
	}
}

// TestPrivateDropsFollowTheirShares: private is the one visibility where the
// URL asks who is knocking. It has to answer exactly the people the panel would
// let in — no wider, and no narrower either, or "private" would mean "broken".
func TestPrivateDropsFollowTheirShares(t *testing.T) {
	ctx := context.Background()
	svc, _ := newTestService(t)
	seedUsers(t, svc)

	drop := aliceDrop(t, svc, "secreto")
	private := model.VisibilityPrivate
	if _, err := svc.UpdateDropMeta(ctx, alice, Own(drop.Path), DropPatch{Visibility: &private}); err != nil {
		t.Fatalf("UpdateDropMeta: %v", err)
	}

	if _, _, err := svc.OpenPublicFile(ctx, alice, drop.Meta.Slug, ""); err != nil {
		t.Fatalf("alice owns it and must be able to open it: %v", err)
	}

	// Bob is signed in, which buys him nothing on its own.
	if _, _, err := svc.OpenPublicFile(ctx, bob, drop.Meta.Slug, ""); !errors.Is(err, ErrNotFound) {
		t.Fatalf("expected ErrNotFound before the share, got %v", err)
	}

	if _, err := svc.Share(ctx, alice, Own(drop.Path), bob, AccessViewer); err != nil {
		t.Fatalf("Share: %v", err)
	}
	if _, _, err := svc.OpenPublicFile(ctx, bob, drop.Meta.Slug, ""); err != nil {
		t.Fatalf("a share has to carry the URL too, or the link is useless to bob: %v", err)
	}

	// And the door closes again. A revoked share that left the URL working
	// would be the worst of both worlds: it looks revoked and is not.
	if err := svc.Unshare(ctx, alice, Own(drop.Path), bob); err != nil {
		t.Fatalf("Unshare: %v", err)
	}
	if _, _, err := svc.OpenPublicFile(ctx, bob, drop.Meta.Slug, ""); !errors.Is(err, ErrNotFound) {
		t.Fatalf("expected ErrNotFound after the share was revoked, got %v", err)
	}

	// The passer-by never had a way in at any point.
	if _, _, err := svc.OpenPublicFile(ctx, anonymous, drop.Meta.Slug, ""); !errors.Is(err, ErrNotFound) {
		t.Fatalf("expected ErrNotFound for an anonymous visitor, got %v", err)
	}
}
