"""
One-time setup script to create your first admin account.

Why a script instead of a public "sign up" page?
A public registration endpoint would let ANYONE create an admin account for
your system, which defeats the purpose of moderation. Instead, only someone
with access to this codebase (you) can run this script directly.

Usage:
    python create_admin.py
"""

import sys
from getpass import getpass

from app import create_app, db
from app.models.models import Admin
from app.auth import hash_password


def main():
    app = create_app()

    with app.app_context():
        username = input("Choose an admin username: ").strip()
        if not username:
            print("Username cannot be empty.")
            sys.exit(1)

        existing = Admin.query.filter_by(Username=username).first()
        if existing:
            print(f"An admin with username '{username}' already exists.")
            sys.exit(1)

        password = getpass("Choose an admin password: ")
        confirm = getpass("Confirm password: ")

        if password != confirm:
            print("Passwords didn't match.")
            sys.exit(1)

        if len(password) < 6:
            print("Password should be at least 6 characters.")
            sys.exit(1)

        admin = Admin(Username=username, Password=hash_password(password))
        db.session.add(admin)
        db.session.commit()

        print(f"\nAdmin account '{username}' created successfully!")
        print("You can now log in at the admin panel with this username/password.")


if __name__ == "__main__":
    main()